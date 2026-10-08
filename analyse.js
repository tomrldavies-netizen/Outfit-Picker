// Reads a clothing photo (ideally the cut-out) and works out:
//  - the main colour plus up to two other colours (prints, stripes, logos)
//  - the pattern: plain, stripe, check, graphic or bold
//  - a guess at the category, only for easy shapes (trousers, shoes, belts)
// This is pixel maths running on your phone: no AI service. You can always
// correct what it fills in. The thresholds live in settings.js → photo.
import { RULES } from './settings.js';
import { rgbToHsl, rgbToHex, rgbToLab } from './colour.js';

const SIZE = 400;   // the photo is shrunk to this many pixels on its longest side
const K = 6;        // how many colour groups to look for before merging

async function readPixels(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, SIZE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const data = ctx.getImageData(0, 0, w, h).data;

  // mask = 1 for pixels that belong to the clothing
  const mask = new Uint8Array(w * h);
  let solid = 0;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 200) { mask[i] = 1; solid++; }
  const cutout = solid > 20 && solid < w * h * 0.95;
  if (!cutout) {
    // Background still there: only look at the middle of the photo.
    mask.fill(0);
    for (let y = Math.floor(h * 0.25); y < h * 0.75; y++) {
      for (let x = Math.floor(w * 0.25); x < w * 0.75; x++) mask[y * w + x] = 1;
    }
  }
  return { data, mask, w, h, cutout };
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Same colour, just lighter or darker (a shadow or crease)?
function sameColour(a, b) {
  const P = RULES.photo;
  return Math.abs(a[0] - b[0]) < P.shadeLightnessGap && Math.hypot(a[1] - b[1], a[2] - b[2]) < P.shadeTintGap;
}

// Distance from colour c to the straight line between colours a and b.
// A small distance means c is just a blend of a and b (e.g. the blurry edge of a stripe).
function blendDistance(c, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2));
  return Math.sqrt(dist2(c, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]));
}

// Group the clothing's pixels into colours.
function findColours(data, mask) {
  const idx = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i);
  const n = idx.length;
  const lab = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const p = idx[j] * 4;
    lab.set(rgbToLab(data[p], data[p + 1], data[p + 2]), j * 3);
  }
  const at = j => [lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]];

  // 1. k-means on a sample of pixels: start from spread-out colours, then refine.
  const step = Math.max(1, Math.floor(n / 5000));
  const sample = [];
  for (let j = 0; j < n; j += step) sample.push(j);
  const mean = [0, 1, 2].map(c => sample.reduce((s, j) => s + lab[j * 3 + c], 0) / sample.length);
  let centres = [mean];
  while (centres.length < K) {
    let far = -1, farD = 0;
    for (const j of sample) {
      const d = Math.min(...centres.map(c => dist2(at(j), c)));
      if (d > farD) { farD = d; far = j; }
    }
    if (farD < 25) break; // everything is already close to a centre
    centres.push(at(far));
  }
  const nearest = p => {
    let best = 0, bestD = Infinity;
    centres.forEach((c, k) => { const d = dist2(p, c); if (d < bestD) { bestD = d; best = k; } });
    return best;
  };
  for (let iter = 0; iter < 12; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const j of sample) {
      const k = nearest(at(j)), s = sums[k];
      s[0] += lab[j * 3]; s[1] += lab[j * 3 + 1]; s[2] += lab[j * 3 + 2]; s[3]++;
    }
    centres = centres.map((c, k) => (sums[k][3] ? [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]] : c));
  }

  // 2. Put every pixel in its nearest group, remembering each group's average real colour.
  const labels = new Int16Array(mask.length).fill(-1);
  const groups = centres.map((lab, id) => ({ id, lab, count: 0, rgb: [0, 0, 0], root: id }));
  for (let j = 0; j < n; j++) {
    const k = nearest(at(j)), g = groups[k], p = idx[j] * 4;
    labels[idx[j]] = k;
    g.count++; g.rgb[0] += data[p]; g.rgb[1] += data[p + 1]; g.rgb[2] += data[p + 2];
  }
  for (const g of groups) g.ownCount = g.count; // before merging adds other groups' pixels
  const live = groups.filter(g => g.count).sort((a, b) => b.count - a.count);

  // 3. Merge shades of the same colour, then drop blurry blends between two colours.
  const find = g => (g.root === g.id ? g : find(groups[g.root]));
  for (let i = live.length - 1; i > 0; i--) {
    const target = live.slice(0, i).find(b => find(b) === b && sameColour(live[i].lab, b.lab));
    if (target) { live[i].root = target.id; target.count += live[i].count; }
  }
  let roots = live.filter(g => find(g) === g).sort((a, b) => b.count - a.count);
  for (let i = roots.length - 1; i >= 2; i--) {
    const c = roots[i];
    outer: for (let a = 0; a < i; a++) {
      for (let b = a + 1; b < i; b++) {
        if (blendDistance(c.lab, roots[a].lab, roots[b].lab) < RULES.photo.blendDistance) {
          const into = dist2(c.lab, roots[a].lab) < dist2(c.lab, roots[b].lab) ? roots[a] : roots[b];
          c.root = into.id; into.count += c.count;
          break outer;
        }
      }
    }
  }
  roots = roots.filter(g => find(g) === g).sort((a, b) => b.count - a.count);

  // Final label for each pixel = the group it ended up merged into.
  const rootOf = groups.map(g => find(g).id);
  for (let i = 0; i < labels.length; i++) if (labels[i] >= 0) labels[i] = rootOf[labels[i]];

  const colours = roots.map(g => {
    const own = groups[g.id], c = own.ownCount || 1;
    const r = own.rgb[0] / c, gg = own.rgb[1] / c, b = own.rgb[2] / c;
    return { id: g.id, share: Math.round((g.count / n) * 100), ...rgbToHsl(r, gg, b), hex: rgbToHex(r, gg, b) };
  });
  return { colours, labels, total: n };
}

// How much a profile (e.g. "share of other colour in each row") goes up and
// down, and how many times it repeats.
function wave(profile) {
  if (profile.length < 8) return { strength: 0, repeats: 0 };
  const mean = profile.reduce((a, b) => a + b, 0) / profile.length;
  const strength = Math.sqrt(profile.reduce((s, v) => s + (v - mean) ** 2, 0) / profile.length);
  const threshold = Math.max(0.04, strength * 0.5);
  let state = 0, flips = 0;
  for (const v of profile) {
    const s = v - mean > threshold ? 1 : v - mean < -threshold ? -1 : 0;
    if (s && s !== state) { if (state) flips++; state = s; }
  }
  return { strength, repeats: flips / 2 };
}

function detectPattern({ mask, w, h }, labels, colours) {
  const P = RULES.photo;
  const mainId = colours[0].id;
  const rowTot = new Array(h).fill(0), colTot = new Array(w).fill(0);
  // For each colour: how many of its pixels are in each row and column.
  const ids = colours.filter(c => c.share >= P.plainMaxOtherShare).map(c => c.id);
  const rowBy = new Map(ids.map(id => [id, new Array(h).fill(0)]));
  const colBy = new Map(ids.map(id => [id, new Array(w).fill(0)]));
  let total = 0, others = 0;
  const xs = [], ys = [];
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      total++; rowTot[y]++; colTot[x]++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (rowBy.has(labels[i])) { rowBy.get(labels[i])[y]++; colBy.get(labels[i])[x]++; }
      if (labels[i] !== mainId) { others++; xs.push(x); ys.push(y); }
    }
  }
  const otherShare = (others / (total || 1)) * 100;
  if (otherShare < P.plainMaxOtherShare) return { pattern: 'plain', reason: 'one main colour' };

  // Does any colour come and go in a repeating rhythm down the rows / across the columns?
  const striped = s => s.repeats >= P.minRepeats && s.strength >= P.minStripeStrength;
  const waves = ids.map(id => ({
    rows: wave(rowTot.map((t, y) => (t >= 4 ? rowBy.get(id)[y] / t : null)).filter(v => v !== null)),
    cols: wave(colTot.map((t, x) => (t >= 4 ? colBy.get(id)[x] / t : null)).filter(v => v !== null)),
  }));
  if (waves.some(({ rows, cols }) => striped(rows) && striped(cols)
    && Math.min(rows.strength, cols.strength) > 0.5 * Math.max(rows.strength, cols.strength))) {
    return { pattern: 'check', reason: 'lines repeating both ways' };
  }
  if (waves.some(({ rows, cols }) => striped(rows) && cols.strength < rows.strength * 0.6)) {
    return { pattern: 'stripe', reason: 'lines repeating down the item' };
  }
  if (waves.some(({ rows, cols }) => striped(cols) && rows.strength < cols.strength * 0.6)) {
    return { pattern: 'stripe', reason: 'lines repeating across the item' };
  }

  // Where are the other colours? Packed into one area = a graphic/logo.
  const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))];
  const area = (pct(xs, 0.95) - pct(xs, 0.05) + 1) * (pct(ys, 0.95) - pct(ys, 0.05) + 1);
  const itemArea = (maxX - minX + 1) * (maxY - minY + 1);
  const spread = (area / itemArea) * 100;
  if (spread < P.graphicMaxArea && otherShare < 45) return { pattern: 'graphic', reason: 'a print in one area' };
  if (otherShare >= P.statementMinShare) return { pattern: 'bold', reason: 'colours spread all over' };
  return { pattern: 'plain', reason: 'mostly one colour' };
}

// Only guesses shapes that are easy to tell apart. Returns null otherwise.
function guessCategory({ mask, w, h, cutout }) {
  if (!cutout) return null;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const aspect = bw / bh;
  if (aspect >= 3.5 || aspect <= 0.28) return { category: 'accessory', reason: 'long and thin, like a belt' };

  // Is there a gap down the middle of this row (between two legs or two shoes)?
  const gapIn = y => {
    let left = -1, right = -1;
    for (let x = minX; x <= maxX; x++) if (mask[y * w + x]) { if (left < 0) left = x; right = x; }
    if (left < 0 || right - left < 10) return false;
    let run = 0, best = 0;
    for (let x = Math.round(left + 0.3 * (right - left)); x <= left + 0.7 * (right - left); x++) {
      run = mask[y * w + x] ? 0 : run + 1;
      best = Math.max(best, run);
    }
    return best >= Math.max(2, bw * 0.04);
  };
  const gapShare = (from, to) => {
    let gaps = 0, rows = 0;
    for (let y = Math.round(minY + from * bh); y < minY + to * bh; y++) { rows++; if (gapIn(y)) gaps++; }
    return rows ? gaps / rows : 0;
  };
  const top = gapShare(0.05, 0.25), bottom = gapShare(0.6, 0.95);
  if (top >= 0.7 && bottom >= 0.7 && aspect > 1) return { category: 'shoes', reason: 'two separate shapes, like a pair of shoes' };
  if (top < 0.2 && bottom >= 0.7) return { category: 'bottom', reason: 'two legs' };
  return null;
}

export async function analysePhoto(blob) {
  const img = await readPixels(blob);
  const { colours, labels } = findColours(img.data, img.mask);
  const [main, ...rest] = colours;
  const P = RULES.photo;
  const accents = rest.filter(c => c.share >= P.accentMinShare).slice(0, P.maxAccentColours);
  const { pattern, reason } = detectPattern(img, labels, colours);
  const strip = ({ id, ...c }) => c;
  return {
    main: strip(main),
    accents: accents.map(strip),
    pattern,
    patternReason: reason,
    guess: guessCategory(img),
  };
}
