// The outfit engine.
//  1. Filter: clean items close enough to the casual-to-smart slider.
//  2. Enumerate every combination of top + bottom + shoes, adding a layer,
//     coat or belt/accessory only when the weather or formality calls for one.
//  3. Throw out combinations that break a hard rule, and score the rest.
//  4. Pick one at random from the best few, weighted toward higher scores.
// All the numbers come from settings.js.
import { RULES } from './settings.js';
import { colourFamily, describeColour, hueDistance } from './colour.js';

export const SLOTS = ['top', 'bottom', 'shoes', 'layer', 'coat', 'accessory'];
export const CATEGORY_LABELS = {
  top: 'Top', bottom: 'Bottom', shoes: 'Shoes', layer: 'Layer', coat: 'Coat', accessory: 'Belt/accessory',
};

export const itemLabel = item => item.name || `${describeColour(item.colour)} ${CATEGORY_LABELS[item.category].toLowerCase()}`;

export const outfitKey = outfit => SLOTS.map(s => outfit.pieces[s]?.id || '-').join('|');

const pieceList = pieces => SLOTS.map(s => pieces[s]).filter(Boolean);
const pairKey = (a, b) => (a < b ? `${a}+${b}` : `${b}+${a}`);
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

// Read the wear history once: when each item was last worn, how often each
// pair of items has been worn together, and when each outfit was last worn.
// Today's entry is ignored so that logging today's outfit doesn't change today's scores.
function readHistory(wears, today) {
  const lastWorn = new Map(), pairCounts = new Map(), outfitLastWorn = new Map();
  for (const w of wears) {
    if (w.date >= today) continue;
    const days = daysBetween(w.date, today);
    const ids = w.itemIds || [];
    for (const id of ids) {
      if (!lastWorn.has(id) || days < lastWorn.get(id)) lastWorn.set(id, days);
    }
    const core = ids.filter(id => id !== w.slots?.accessory);
    for (let i = 0; i < core.length; i++) {
      for (let j = i + 1; j < core.length; j++) {
        const k = pairKey(core[i], core[j]);
        pairCounts.set(k, (pairCounts.get(k) || 0) + 1);
      }
    }
    if (w.slots) {
      const k = [w.slots.top, w.slots.bottom, w.slots.shoes].join('|');
      if (!outfitLastWorn.has(k) || days < outfitLastWorn.get(k)) outfitLastWorn.set(k, days);
    }
  }
  return { lastWorn, pairCounts, outfitLastWorn };
}

// Hard rules between top and bottom, checked early to skip whole branches.
function topBottomProblem(top, bottom) {
  const C = RULES.colour;
  if (C.requireTopBottomContrast && Math.abs(top.colour.l - bottom.colour.l) < C.minTopBottomContrast) {
    return 'Top and bottom too similar in lightness';
  }
  if (top.pattern === 'bold' && bottom.pattern === 'bold' && RULES.pattern.maxBold < 2) {
    return `More than ${RULES.pattern.maxBold} bold pattern`;
  }
  return null;
}

// Group the non-neutral pieces by colour (hues close together count as one colour).
function colourGroups(list) {
  const groups = [];
  for (const it of list) {
    if (it.family !== 'coloured') continue;
    const g = groups.find(gr => hueDistance(gr.hue, it.colour.h) <= RULES.colour.sameColourWithinDegrees);
    if (g) g.items.push(it);
    else groups.push({ hue: it.colour.h, items: [it] });
  }
  return groups;
}

function beltMatchesShoes(belt, shoes) {
  if (belt.family !== 'coloured' || shoes.family !== 'coloured') return belt.family === shoes.family;
  return hueDistance(belt.colour.h, shoes.colour.h) <= 25 && Math.abs(belt.colour.l - shoes.colour.l) <= 20;
}

// Score one outfit. With explain = true it also returns a line-by-line
// breakdown for the debug view.
export function scoreOutfit(pieces, ctx, explain = false) {
  const S = RULES.scores;
  const list = pieceList(pieces);

  // ----- Hard rules: break one and the outfit is out -----
  const tb = topBottomProblem(pieces.top, pieces.bottom);
  if (tb) return { valid: false, reason: tb };
  const groups = colourGroups(list);
  if (groups.length > RULES.colour.maxColours) return { valid: false, reason: `More than ${RULES.colour.maxColours} colours` };
  if (list.filter(i => i.pattern === 'bold').length > RULES.pattern.maxBold) {
    return { valid: false, reason: `More than ${RULES.pattern.maxBold} bold pattern` };
  }

  let total = 0;
  const parts = explain ? [] : null;
  const add = (label, pts) => {
    if (!pts) return;
    total += pts;
    if (parts) parts.push({ label, pts: Math.round(pts * 10) / 10 });
  };

  // ----- Colour -----
  const C = S.colour;
  if (!groups.length) add('All neutrals', C.allNeutral);
  else if (groups.length === 1) {
    if (groups[0].items.length > 1) add('Monochrome: one colour across pieces', C.monochrome);
    else add('One colour with neutrals', C.singleAccent);
  } else {
    const d = Math.round(hueDistance(groups[0].hue, groups[1].hue));
    if (d <= RULES.colour.analogousMaxDegrees) add(`Analogous colours (${d}° apart)`, C.analogous);
    else if (d >= RULES.colour.complementaryMinDegrees) add(`Complementary colours (${d}° apart)`, C.complementary);
    else add(`Colours clash on the wheel (${d}° apart)`, C.clash);
  }
  const contrast = Math.abs(pieces.top.colour.l - pieces.bottom.colour.l);
  add(`Top/bottom lightness contrast (${contrast})`, C.contrastMax * Math.min(contrast, 50) / 50);

  if (pieces.accessory?.isBelt) {
    if (beltMatchesShoes(pieces.accessory, pieces.shoes)) add('Belt matches shoes', S.beltMatchesShoes);
    else add("Belt doesn't match shoes", S.beltClashesShoes);
  }

  // ----- Pattern -----
  const patterned = list.filter(i => i.pattern && i.pattern !== 'plain').length;
  if (patterned > 1) add(`${patterned} patterned pieces`, S.patternMixPerExtra * (patterned - 1));

  // ----- Style -----
  const tagCounts = new Map();
  for (const it of list) for (const t of it.styles || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  let bestTag = null, bestCount = 0;
  for (const [t, n] of tagCounts) if (n > bestCount) { bestTag = t; bestCount = n; }
  if (bestCount >= 2) add(`${bestCount}/${list.length} pieces share "${bestTag}" style`, S.styleMatch * bestCount / list.length);

  // ----- Formality -----
  const formalityOff = list.reduce((sum, i) => sum + Math.abs(i.formality - ctx.formality), 0);
  add(`Formality off slider by ${formalityOff} in total`, S.formalityOffPerPoint * formalityOff);

  // ----- Weather -----
  const w = ctx.weather;
  const target = w.targetWarmth;
  const topTarget = Math.max(1, target - (pieces.layer ? 1 : 0) - (pieces.coat ? 1 : 0));
  let warmthOff = Math.abs(pieces.top.warmth - topTarget)
    + Math.abs(pieces.bottom.warmth - target)
    + Math.abs(pieces.shoes.warmth - target) * 0.5;
  if (pieces.layer) warmthOff += Math.abs(pieces.layer.warmth - target);
  if (pieces.coat) warmthOff += Math.abs(pieces.coat.warmth - target);
  add(`Warmth off today's target by ${warmthOff}`, S.warmthOffPerPoint * warmthOff);

  if (w.raining) {
    if (pieces.coat) {
      if (pieces.coat.waterproof) add('Waterproof coat for rain', S.rain.waterproofCoat);
      else add("Coat isn't waterproof", S.rain.notWaterproofCoat);
    }
    if (pieces.shoes.waterproof) add('Waterproof shoes for rain', S.rain.waterproofShoes);
    else add("Shoes aren't waterproof", S.rain.notWaterproofShoes);
  }
  if (w.needsCoat && !pieces.coat) add('Needs a coat but none available', S.missingOuterwear);
  else if (w.needsLayer && !pieces.layer && !pieces.coat) add('Needs a layer but none available', S.missingOuterwear);

  // ----- Wear history -----
  const h = ctx.history;
  for (const it of list) {
    const d = h.lastWorn.get(it.id);
    if (d !== undefined && d < S.recentDays) {
      add(`${itemLabel(it)} worn ${d === 1 ? 'yesterday' : `${d} days ago`}`, S.recentlyWorn * (1 - (d - 1) / S.recentDays));
    }
  }
  const sameDays = h.outfitLastWorn.get([pieces.top.id, pieces.bottom.id, pieces.shoes.id].join('|'));
  if (sameDays !== undefined && sameDays < S.sameOutfitDays) {
    add(`Same top, bottom & shoes worn ${sameDays} day${sameDays === 1 ? '' : 's'} ago`, S.sameOutfitRecently);
  }

  // ----- Novelty: reward pieces rarely or never worn together -----
  const core = list.filter(i => i !== pieces.accessory);
  let freshness = 0, pairs = 0, worstCount = 0;
  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      const n = h.pairCounts.get(pairKey(core[i].id, core[j].id)) || 0;
      freshness += 1 / (1 + n);
      worstCount = Math.max(worstCount, n);
      pairs++;
    }
  }
  const novelty = pairs ? freshness / pairs : 1;
  const noveltyWeight = S.novelty * (ctx.tryNew ? S.tryNewNoveltyMultiplier : 1);
  const label = worstCount === 0 ? 'Never worn together' : `Novelty (some pieces worn together up to ${worstCount}×)`;
  add(label + (ctx.tryNew ? ' (Try something new ×' + S.tryNewNoveltyMultiplier + ')' : ''), noveltyWeight * novelty);

  return { valid: true, total, parts };
}

function enumerate(clean, ctx, tolerance) {
  const fits = i => Math.abs(i.formality - ctx.formality) <= tolerance;
  const pick = cat => clean.filter(i => i.category === cat && fits(i));
  const tops = pick('top'), bottoms = pick('bottom'), shoes = pick('shoes');
  const layers = pick('layer'), coats = pick('coat'), accessories = pick('accessory');
  const notes = [];

  const missing = [['top', tops], ['bottom', bottoms], ['shoes', shoes]].filter(([, l]) => !l.length).map(([c]) => c);
  if (missing.length) return { outfits: [], total: 0, rejected: {}, notes, missing, tolerance };

  // Optional pieces: [null] means "leave this slot empty".
  const w = ctx.weather;
  let layerOptions = [null], coatOptions = [null];
  if (w.needsLayer) {
    if (layers.length) layerOptions = layers;
    else if (!w.needsCoat && coats.length) { coatOptions = coats; notes.push('No clean layer in range, so using a coat instead.'); }
    else notes.push('A layer would help today, but none are clean and in range.');
  }
  if (w.needsCoat) {
    if (coats.length) coatOptions = coats;
    else notes.push('A coat is needed today, but none are clean and in range.');
  }
  const accessoryOptions = ctx.formality >= RULES.formality.accessoryFrom && accessories.length ? accessories : [null];

  const rejected = {};
  let kept = [], total = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      const early = topBottomProblem(top, bottom);
      if (early) {
        rejected[early] = (rejected[early] || 0) + shoes.length * layerOptions.length * coatOptions.length * accessoryOptions.length;
        continue;
      }
      for (const shoe of shoes) for (const layer of layerOptions) for (const coat of coatOptions) for (const accessory of accessoryOptions) {
        const pieces = { top, bottom, shoes: shoe, layer, coat, accessory };
        const r = scoreOutfit(pieces, ctx);
        if (!r.valid) { rejected[r.reason] = (rejected[r.reason] || 0) + 1; continue; }
        total++;
        kept.push({ pieces, score: r.total });
        // Keep memory small on big wardrobes: only the best 1000 survive.
        if (kept.length > 5000) { kept.sort((a, b) => b.score - a.score); kept.length = 1000; }
      }
    }
  }
  kept.sort((a, b) => b.score - a.score);
  return { outfits: kept.slice(0, 200), total, rejected, notes, missing, tolerance };
}

export function findOutfits({ items, wears, weather, formality, tryNew, today }) {
  // Work on copies with the colour family worked out once per item.
  const clean = items.filter(i => !i.dirty).map(i => ({ ...i, family: colourFamily(i.colour) }));
  const ctx = { weather, formality, tryNew, history: readHistory(wears, today) };
  let result = enumerate(clean, ctx, RULES.formality.tolerance);
  if (!result.outfits.length && RULES.formality.fallbackTolerance > RULES.formality.tolerance) {
    const wider = enumerate(clean, ctx, RULES.formality.fallbackTolerance);
    if (wider.outfits.length) {
      wider.notes.unshift(`Not enough matches at this formality, so I widened the range to ±${wider.tolerance}.`);
      result = wider;
    }
  }
  return { ...result, ctx };
}

// Chance of each outfit in the pool being picked: higher scores are more
// likely, and "spread" controls how strongly.
export function selectionChances(outfits, tryNew) {
  const pool = outfits.slice(0, RULES.selection.poolSize);
  if (!pool.length) return [];
  const spread = tryNew ? RULES.selection.tryNewSpread : RULES.selection.spread;
  const best = pool[0].score;
  const weights = pool.map(o => Math.exp((o.score - best) / spread));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map(x => x / sum);
}

// Weighted random pick from the pool, skipping outfits already shown
// (once all have been shown, start again).
export function pickOutfit(outfits, tryNew, seen = new Set()) {
  const pool = outfits.slice(0, RULES.selection.poolSize);
  if (!pool.length) return null;
  const chances = selectionChances(pool, tryNew);
  let candidates = pool.map((o, i) => ({ o, p: chances[i] })).filter(c => !seen.has(outfitKey(c.o)));
  if (!candidates.length) {
    seen.clear();
    candidates = pool.map((o, i) => ({ o, p: chances[i] }));
  }
  const sum = candidates.reduce((a, c) => a + c.p, 0);
  let r = Math.random() * sum;
  for (const c of candidates) {
    r -= c.p;
    if (r <= 0) return c.o;
  }
  return candidates[candidates.length - 1].o;
}
