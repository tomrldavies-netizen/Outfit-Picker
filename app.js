// The app's screens and buttons. The clever parts live in other files:
//   scoring.js (picking outfits), colour.js, weather.js, photo.js, storage.js
import { RULES } from './settings.js';
import * as db from './storage.js';
import { FAMILIES, classifyColour, dominantColour, hexToHsl } from './colour.js';
import { resolveLocation, fetchForecast, summarise, unknownWeather, searchTown, clearWeatherCache } from './weather.js';
import { findOutfits, pickOutfit, scoreOutfit, selectionChances, outfitKey, itemLabel, SLOTS, CATEGORY_LABELS } from './scoring.js';
import { prepare, cutOut, keepOriginal } from './photo.js';

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);

// Build an element: el('button', { class: 'btn', onclick: fn }, 'Label')
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

// ---------- App state ----------
const state = {
  items: [],
  wears: [],
  prefs: db.loadPrefs(),
  weather: null,
  weatherError: null,
  result: null,       // every scored outfit for today
  current: null,      // the outfit on screen
  seen: new Set(),    // outfits already shown, so Reshuffle shows something new
  filter: 'all',      // wardrobe filter
};

// Photos are stored as files ("blobs"); the screen needs a temporary URL for each.
const urlCache = new Map();
function photoUrl(item) {
  if (!item.photo) return null;
  const cached = urlCache.get(item.id);
  if (cached?.blob === item.photo) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(item.photo);
  urlCache.set(item.id, { blob: item.photo, url });
  return url;
}

function itemPic(item) {
  const url = photoUrl(item);
  if (url) return el('img', { src: url, alt: itemLabel(item) });
  const light = (item.colour?.l ?? 50) > 55;
  return el('div', { class: 'ph', style: `background:${item.colour?.hex || '#999'};color:${light ? '#2B2724' : '#fff'}` },
    CATEGORY_LABELS[item.category]);
}

// ---------- Navigation ----------
function showScreen(name) {
  if (!['today', 'wardrobe', 'settings'].includes(name)) name = 'today';
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== `screen-${name}`; });
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

// ---------- Weather ----------
async function loadWeather() {
  $('#weather').replaceChildren(el('span', { class: 'muted' }, 'Checking the weather…'));
  try {
    const loc = await resolveLocation(state.prefs);
    state.weather = summarise(await fetchForecast(loc), loc.name);
    state.weatherError = null;
  } catch (e) {
    state.weather = unknownWeather();
    state.weatherError = e.message;
  }
  renderWeather();
  recompute();
}

function renderWeather() {
  const w = state.weather, box = $('#weather');
  box.replaceChildren();
  if (state.weatherError) {
    box.append(
      el('div', { class: 'big' }, '❔'),
      el('div', { class: 'grow' },
        el('div', { class: 'small' }, state.weatherError),
        el('button', { class: 'btn btn-small', style: 'margin-top:6px', onclick: () => showScreen('settings') }, 'Set my town')),
    );
    return;
  }
  const tags = [];
  if (w.needsLayer) tags.push('Layer');
  if (w.needsCoat) tags.push(w.raining ? 'Waterproof coat' : 'Coat');
  if (!tags.length) tags.push('No layer needed');
  box.append(
    el('div', { class: 'big' }, w.icon),
    el('div', { class: 'grow' },
      el('div', {}, el('span', { class: 'temp' }, `${w.feels}°`), ` feels like · ${w.desc}`),
      el('div', { class: 'muted small' }, `${w.locationName} · ${w.low}°–${w.high}° · ${w.rainChance}% rain`),
      el('div', { class: 'tags' }, tags.map(t => el('span', { class: 'tag' }, t)))),
    el('button', { class: 'btn btn-ghost btn-small', 'aria-label': 'Refresh weather', onclick: () => { clearWeatherCache(); loadWeather(); } }, '↻'),
  );
}

// ---------- Today's outfit ----------
// keepPick: show the same outfit as earlier today if it still fits
// (so the app doesn't change its mind every time you open it).
function recompute({ keepPick = true } = {}) {
  const p = state.prefs, today = todayStr();
  state.result = findOutfits({
    items: state.items, wears: state.wears, weather: state.weather || unknownWeather(),
    formality: p.formality, tryNew: p.tryNew, today,
  });
  state.seen = new Set();
  const find = key => key && state.result.outfits.find(o => outfitKey(o) === key);
  let chosen = null;
  if (keepPick) {
    chosen = find(state.wears.find(w => w.date === today)?.key);
    const saved = p.todayPick;
    if (!chosen && saved?.date === today && saved.formality === p.formality && saved.tryNew === p.tryNew) chosen = find(saved.key);
  }
  setCurrent(chosen || pickOutfit(state.result.outfits, p.tryNew, state.seen));
}

function setCurrent(outfit) {
  state.current = outfit;
  if (outfit) state.seen.add(outfitKey(outfit));
  if (outfit && state.weather) { // don't remember a pick made before the weather arrived
    state.prefs.todayPick = { date: todayStr(), formality: state.prefs.formality, tryNew: state.prefs.tryNew, key: outfitKey(outfit) };
    db.savePrefs(state.prefs);
  }
  renderOutfit();
  renderDebug();
}

function reshuffle() {
  if (Math.min(state.result.outfits.length, RULES.selection.poolSize) <= 1) {
    toast('This is the only outfit that fits right now.');
    return;
  }
  setCurrent(pickOutfit(state.result.outfits, state.prefs.tryNew, state.seen));
}

async function wearCurrent() {
  const o = state.current;
  if (!o) return;
  const slots = {};
  for (const s of SLOTS) if (o.pieces[s]) slots[s] = o.pieces[s].id;
  const entry = { date: todayStr(), key: outfitKey(o), slots, itemIds: Object.values(slots), at: Date.now() };
  await db.put('wears', entry);
  state.wears = state.wears.filter(w => w.date !== entry.date).concat(entry);
  renderOutfit();
  toast('Logged for today. Have a good one!');
}

function whyNoOutfit(r) {
  if (r.missing.length) {
    return [
      `You need at least one clean ${r.missing.join(', ')} within ±${r.tolerance} of the formality slider.`,
      'Try moving the slider, clearing dirty items, or adding more clothes.',
    ];
  }
  const reasons = Object.entries(r.rejected).sort((a, b) => b[1] - a[1])
    .map(([why, n]) => `${why}: ${n} combination${n === 1 ? '' : 's'}`);
  return ['Every combination broke a rule:', ...reasons, 'Try another formality, or relax the rules in settings.js.'];
}

function renderOutfit() {
  const card = $('#outfitCard'), names = $('#outfitNames'), notes = $('#outfitNotes');
  card.replaceChildren(); names.replaceChildren(); notes.replaceChildren();
  const r = state.result, o = state.current;
  $('#reshuffleBtn').disabled = !o;
  $('#wearBtn').disabled = !o;

  if (!state.items.length) {
    card.className = 'flatlay empty';
    card.append(
      el('p', {}, el('strong', {}, 'Your wardrobe is empty')),
      el('p', { class: 'muted' }, 'Add a few tops, bottoms and shoes to get outfit ideas.'),
      el('button', { class: 'btn btn-primary', onclick: () => openEditor() }, '+ Add your first item'),
    );
    return;
  }
  if (!o) {
    card.className = 'flatlay empty';
    card.append(el('p', {}, el('strong', {}, 'No outfit found')), whyNoOutfit(r).map(t => el('p', { class: 'muted small' }, t)));
    return;
  }

  // Flat-lay: outerwear + top along the top, bottom right, shoes + accessory left.
  const p = o.pieces;
  const outer = [p.coat, p.layer].filter(Boolean);
  card.className = 'flatlay' + (outer.length ? '' : ' no-outer') + (p.accessory ? '' : ' no-acc');
  const slot = (name, items) => el('div', { class: `slot slot-${name}${items.length > 1 ? ' two' : ''}` }, items.map(itemPic));
  if (outer.length) card.append(slot('outer', outer));
  card.append(slot('top', [p.top]), slot('bottom', [p.bottom]), slot('shoes', [p.shoes]));
  if (p.accessory) card.append(slot('acc', [p.accessory]));

  for (const s of SLOTS) {
    if (!p[s]) continue;
    names.append(el('li', {}, el('button', { type: 'button', onclick: () => openEditor(state.items.find(i => i.id === p[s].id)) }, itemLabel(p[s]))));
  }
  for (const n of r.notes) notes.append(el('p', {}, n));
  if (state.weatherError) notes.append(el('p', {}, 'Weather unavailable, so this assumes a mild, dry day.'));

  const worn = state.wears.find(w => w.date === todayStr());
  const isWorn = worn?.key === outfitKey(o);
  const wb = $('#wearBtn');
  wb.textContent = isWorn ? '✓ Wearing this today' : "I'm wearing this";
  wb.classList.toggle('done', isWorn);
}

// ---------- Debug view: every score, line by line ----------
function renderDebug() {
  const box = $('#debug');
  box.hidden = !state.prefs.debug;
  if (!state.prefs.debug || !state.result) return;
  box.replaceChildren();
  const r = state.result, w = state.weather || unknownWeather();
  const F = state.prefs.formality;
  box.append(
    el('h3', {}, 'Debug: how this was picked'),
    el('ul', {},
      w.reasons.map(t => el('li', {}, t)),
      el('li', {}, `Formality ${F}: items within ±${r.tolerance}${F >= RULES.formality.accessoryFrom ? ', belt/accessory added' : ', no accessory'}`),
      state.prefs.tryNew && el('li', {}, 'Try something new: novelty boosted, wider random pick')),
  );
  const rejectedTotal = Object.values(r.rejected).reduce((a, b) => a + b, 0);
  box.append(el('p', {}, `${r.total} valid outfit${r.total === 1 ? '' : 's'}, ${rejectedTotal} rejected by hard rules.`));
  if (rejectedTotal) box.append(el('ul', {}, Object.entries(r.rejected).map(([k, n]) => el('li', {}, `${k}: ${n}`))));

  const pool = r.outfits.slice(0, RULES.selection.poolSize);
  if (!pool.length) return;
  const chances = selectionChances(pool, state.prefs.tryNew);
  const currentKey = state.current && outfitKey(state.current);
  box.append(el('h3', {}, `Top ${pool.length}: Reshuffle picks from these (score · chance)`));
  pool.forEach((o, i) => {
    const { parts } = scoreOutfit(o.pieces, r.ctx, true);
    const isCurrent = outfitKey(o) === currentKey;
    box.append(el('details', { class: isCurrent ? 'current' : null, open: isCurrent },
      el('summary', {},
        el('span', {}, `#${i + 1}`),
        el('span', { class: 'thumbs' }, SLOTS.filter(s => o.pieces[s]).map(s => itemPic(o.pieces[s]))),
        el('span', { class: 'score' }, o.score.toFixed(1)),
        el('span', { class: 'muted' }, `${Math.round(chances[i] * 100)}%`)),
      el('table', {}, parts.map(pt => el('tr', {},
        el('td', {}, pt.label),
        el('td', { class: pt.pts >= 0 ? 'pos' : 'neg' }, (pt.pts > 0 ? '+' : '') + pt.pts)))),
      !isCurrent && el('button', { class: 'btn btn-small', style: 'margin-top:6px', onclick: () => setCurrent(o) }, 'Show this outfit'),
    ));
  });
}

// ---------- Wardrobe ----------
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

function renderWardrobe() {
  const filters = ['all', ...CATEGORY_ORDER, 'dirty'];
  const matches = (item, f) => f === 'all' || (f === 'dirty' ? item.dirty : item.category === f);
  const count = f => state.items.filter(i => matches(i, f)).length;

  $('#wardrobeFilters').replaceChildren(...filters.map(f => el('button', {
    class: 'chip' + (state.filter === f ? ' on' : ''),
    onclick: () => { state.filter = f; renderWardrobe(); },
  }, `${f === 'all' ? 'All' : f === 'dirty' ? '🧺 Dirty' : CATEGORY_LABELS[f]} ${count(f)}`)));
  $('#laundryBtn').hidden = !count('dirty');

  const shown = state.items.filter(i => matches(i, state.filter))
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.createdAt - b.createdAt);
  const grid = $('#wardrobeGrid');
  grid.replaceChildren();
  if (!shown.length) {
    grid.append(el('p', { class: 'empty-msg' }, state.items.length ? 'Nothing here.' : 'No clothes yet. Tap “+ Add item” to start.'));
  }
  for (const item of shown) {
    grid.append(el('div', { class: 'tile' + (item.dirty ? ' dirty' : ''), onclick: () => openEditor(item) },
      el('div', { class: 'pic' }, itemPic(item)),
      el('div', { class: 'info' },
        el('strong', {}, itemLabel(item)),
        el('span', { class: 'muted' }, `${CATEGORY_LABELS[item.category]} · warmth ${item.warmth} · formality ${item.formality}`)),
      el('button', {
        class: 'dirty-btn', type: 'button', 'aria-label': item.dirty ? 'Mark clean' : 'Mark dirty',
        onclick: e => { e.stopPropagation(); saveItem({ ...item, dirty: !item.dirty }); },
      }, item.dirty ? '🧺 Dirty' : 'Clean'),
    ));
  }
}

async function saveItem(item) {
  await db.put('items', item);
  const i = state.items.findIndex(x => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.push(item);
  renderWardrobe();
  recompute();
}

async function laundryDone() {
  const dirty = state.items.filter(i => i.dirty);
  for (const item of dirty) await db.put('items', { ...item, dirty: false });
  state.items = state.items.map(i => (i.dirty ? { ...i, dirty: false } : i));
  renderWardrobe();
  recompute();
  toast(`${dirty.length} item${dirty.length === 1 ? '' : 's'} back in rotation`);
}

// ---------- Add / edit item ----------
const ed = { item: null, original: null, cutout: null };
let photoJob = 0;      // so a slow, cancelled photo doesn't overwrite a newer one
let previewUrl = null;

function fillSeg(name, options) {
  document.querySelector(`[data-seg="${name}"]`).replaceChildren(...options.map(([value, label]) =>
    el('label', {}, el('input', { type: 'radio', name, value, required: true }), el('span', {}, String(label)))));
}
const segValue = name => $(`#editorForm input[name="${name}"]:checked`)?.value;
function setSeg(name, value) {
  document.querySelectorAll(`#editorForm input[name="${name}"]`).forEach(r => { r.checked = r.value === String(value); });
}

function showPreview(blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;
  $('#photoPreview').replaceChildren(blob ? el('img', { src: previewUrl, alt: 'Item photo' }) : el('span', { class: 'muted' }, 'No photo yet'));
}

function updateColourHint(prefix = '') {
  const hsl = hexToHsl($('#colourPicker').value);
  const auto = classifyColour(hsl);
  const select = $('#colourFamily');
  select.options[0].textContent = `Auto: ${auto}`;
  const fam = select.value === 'auto' ? auto : select.value;
  $('#colourHint').textContent = prefix + (fam === 'coloured'
    ? 'Coloured: matched using the colour wheel (max 2 colours per outfit).'
    : 'Neutral: goes with anything.') + ' Tap the swatch or menu to correct it.';
}

function updateBeltRow() {
  $('#beltRow').hidden = segValue('category') !== 'accessory';
}

function setupEditor() {
  fillSeg('category', Object.entries(CATEGORY_LABELS));
  fillSeg('warmth', [1, 2, 3, 4, 5].map(n => [n, n]));
  fillSeg('formality', [1, 2, 3, 4, 5].map(n => [n, n]));
  fillSeg('pattern', [['plain', 'Plain'], ['stripe', 'Stripe'], ['check', 'Check'], ['bold', 'Bold']]);
  $('#colourFamily').replaceChildren(
    el('option', { value: 'auto' }, 'Auto'),
    FAMILIES.map(f => el('option', { value: f }, f === 'coloured' ? 'Coloured (not neutral)' : `Neutral: ${f}`)),
  );
  $('#styleChips').replaceChildren(...RULES.styleTags.map(tag =>
    el('button', { type: 'button', class: 'chip', 'data-tag': tag, onclick: e => e.currentTarget.classList.toggle('on') }, tag)));

  for (const input of [$('#cameraInput'), $('#galleryInput')]) {
    input.addEventListener('change', () => { handlePhoto(input.files[0]); input.value = ''; });
  }
  $('#keepOriginal').addEventListener('change', () => showPreview($('#keepOriginal').checked ? ed.original : ed.cutout));
  $('#editorForm').addEventListener('change', e => { if (e.target.name === 'category') updateBeltRow(); });
  $('#colourPicker').addEventListener('input', () => updateColourHint());
  $('#colourFamily').addEventListener('change', () => updateColourHint());
  $('#editorForm').addEventListener('submit', saveEditor);
  $('#editorCancel').addEventListener('click', () => { photoJob++; $('#editor').close(); });
  $('#deleteItemBtn').addEventListener('click', deleteEditing);
}

function openEditor(item = null) {
  photoJob++;
  ed.item = item; ed.original = null; ed.cutout = null;
  $('#editorTitle').textContent = item ? 'Edit item' : 'Add item';
  $('#itemName').value = item?.name || '';
  setSeg('category', item?.category || (state.filter in CATEGORY_LABELS ? state.filter : ''));
  setSeg('warmth', item?.warmth || 3);
  setSeg('formality', item?.formality || 3);
  setSeg('pattern', item?.pattern || 'plain');
  $('#waterproof').checked = !!item?.waterproof;
  $('#isBelt').checked = item ? item.isBelt !== false : true;
  $('#isDirty').checked = !!item?.dirty;
  document.querySelectorAll('#styleChips .chip').forEach(c => c.classList.toggle('on', !!item?.styles?.includes(c.dataset.tag)));
  $('#colourPicker').value = item?.colour?.hex || '#808080';
  $('#colourFamily').value = item?.colour?.override || 'auto';
  $('#keepOriginalRow').hidden = true;
  $('#keepOriginal').checked = false;
  $('#cameraLabel').textContent = item?.photo ? '📷 Retake' : '📷 Take photo';
  $('#photoStatus').textContent = item ? '' : 'Tip: lay the item flat or hang it up against a plain background.';
  showPreview(item?.photo || null);
  $('#deleteItemBtn').hidden = !item;
  updateBeltRow();
  updateColourHint();
  $('#editor').showModal();
  $('#editorForm').scrollTop = 0;
}

async function handlePhoto(file) {
  if (!file) return;
  const job = ++photoJob;
  const status = text => { if (job === photoJob) $('#photoStatus').textContent = text; };
  $('#keepOriginalRow').hidden = true;
  $('#cameraLabel').textContent = '📷 Retake';
  status('Preparing photo…');
  try {
    ed.original = await prepare(file);
  } catch {
    status("Couldn't read that photo. Try another.");
    return;
  }
  ed.cutout = null;
  showPreview(ed.original);
  $('#photoPreview').classList.add('busy');
  try {
    const cut = await cutOut(ed.original, status);
    if (job !== photoJob) return;
    ed.cutout = cut;
    $('#keepOriginal').checked = false;
    showPreview(cut);
    status('Background removed. Looks wrong? Tap Retake, or keep the original background.');
  } catch (e) {
    if (job !== photoJob) return;
    $('#keepOriginal').checked = true;
    status(`Couldn't remove the background (${e.message || e}). Retake, or save it with the background.`);
  }
  $('#photoPreview').classList.remove('busy');
  $('#keepOriginalRow').hidden = !ed.cutout;

  try {
    const colour = await dominantColour(ed.cutout || ed.original);
    if (job !== photoJob) return;
    $('#colourPicker').value = colour.hex;
    $('#colourFamily').value = 'auto';
    updateColourHint('Detected from photo. ');
  } catch { /* keep whatever colour was there */ }
}

async function saveEditor(e) {
  e.preventDefault();
  const category = segValue('category');
  if (!category) return toast('Pick a category');
  const hex = $('#colourPicker').value;
  const family = $('#colourFamily').value;
  let photo = ed.item?.photo || null;
  if (ed.original) photo = ($('#keepOriginal').checked || !ed.cutout) ? await keepOriginal(ed.original) : ed.cutout;
  const isNew = !ed.item;
  const item = {
    id: ed.item?.id || crypto.randomUUID(),
    name: $('#itemName').value.trim(),
    category,
    isBelt: category === 'accessory' && $('#isBelt').checked,
    warmth: Number(segValue('warmth')),
    formality: Number(segValue('formality')),
    pattern: segValue('pattern'),
    waterproof: $('#waterproof').checked,
    colour: { ...hexToHsl(hex), hex, override: family === 'auto' ? null : family },
    styles: [...document.querySelectorAll('#styleChips .chip.on')].map(c => c.dataset.tag),
    dirty: $('#isDirty').checked,
    photo,
    createdAt: ed.item?.createdAt || Date.now(),
  };
  photoJob++;
  await saveItem(item);
  $('#editor').close();
  navigator.storage?.persist?.(); // ask the phone not to clear our data when space is low
  toast(isNew ? 'Added to your wardrobe' : 'Saved');
}

async function deleteEditing() {
  const item = ed.item;
  if (!item || !confirm(`Delete "${itemLabel(item)}"? This can't be undone.`)) return;
  await db.remove('items', item.id);
  state.items = state.items.filter(i => i.id !== item.id);
  $('#editor').close();
  renderWardrobe();
  recompute();
  toast('Deleted');
}

// ---------- Settings ----------
function renderSettings() {
  const p = state.prefs;
  $('#useGps').checked = p.useGps;
  $('#savedTown').textContent = p.town?.name || 'none';
  $('#debugToggle').checked = p.debug;

  const names = new Map(state.items.map(i => [i.id, itemLabel(i)]));
  const recent = [...state.wears].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  $('#historyList').replaceChildren(...(recent.length ? recent.map(w => el('li', {},
    el('div', { class: 'grow' },
      el('strong', {}, new Date(`${w.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })),
      el('div', { class: 'muted small' }, w.itemIds.map(id => names.get(id) || '(deleted item)').join(' · '))),
    el('button', {
      class: 'x', 'aria-label': 'Remove this day',
      onclick: async () => {
        await db.remove('wears', w.date);
        state.wears = state.wears.filter(x => x.date !== w.date);
        renderSettings(); recompute();
      },
    }, '×'),
  )) : [el('li', { class: 'muted' }, 'Nothing logged yet. Tap “I’m wearing this” on the Today screen.')]));
  $('#clearHistoryBtn').hidden = !state.wears.length;

  navigator.storage?.estimate?.().then(async est => {
    const persisted = await navigator.storage.persisted?.();
    $('#storageInfo').textContent = `Using about ${(est.usage / 1048576).toFixed(1)} MB on this phone`
      + (persisted ? ' (protected from automatic clean-up).' : '.');
  }).catch(() => {});
}

function setupSettings() {
  $('#useGps').addEventListener('change', e => {
    state.prefs.useGps = e.target.checked;
    db.savePrefs(state.prefs);
    clearWeatherCache();
    loadWeather();
  });

  $('#townForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#townInput').value.trim();
    if (!q) return;
    const list = $('#townResults');
    list.replaceChildren(el('li', { class: 'muted' }, 'Searching…'));
    try {
      const results = await searchTown(q);
      list.replaceChildren(...(results.length ? results.map(r => el('li', {},
        el('button', {
          class: 'link', type: 'button',
          onclick: () => {
            state.prefs.town = r;
            db.savePrefs(state.prefs);
            list.replaceChildren();
            $('#townInput').value = '';
            renderSettings();
            clearWeatherCache();
            loadWeather();
            toast(`Saved ${r.name}`);
          },
        }, r.name))) : [el('li', { class: 'muted' }, 'No towns found.')]));
    } catch (err) {
      list.replaceChildren(el('li', { class: 'muted' }, err.message));
    }
  });

  $('#exportBtn').addEventListener('click', async () => {
    const blob = await db.exportBackup(state.prefs);
    const a = el('a', { href: URL.createObjectURL(blob), download: `outfit-backup-${todayStr()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Backup saved to your Downloads');
  });

  $('#importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const backup = await db.readBackup(file);
      if (!confirm(`Replace your wardrobe (${state.items.length} items) with this backup (${backup.items.length} items)?`)) return;
      await db.replaceAll(backup.items, backup.wears);
      state.items = backup.items;
      state.wears = backup.wears;
      if (backup.prefs.town) state.prefs.town = backup.prefs.town;
      if (typeof backup.prefs.useGps === 'boolean') state.prefs.useGps = backup.prefs.useGps;
      db.savePrefs(state.prefs);
      renderWardrobe();
      renderSettings();
      recompute();
      toast('Backup restored');
    } catch (err) {
      toast(err.message);
    }
  });

  $('#clearHistoryBtn').addEventListener('click', async () => {
    if (!confirm('Clear all wear history? Recently-worn and novelty scores will start fresh.')) return;
    await db.clearStore('wears');
    state.wears = [];
    renderSettings();
    recompute();
  });

  $('#debugToggle').addEventListener('change', e => {
    state.prefs.debug = e.target.checked;
    db.savePrefs(state.prefs);
    renderDebug();
  });
}

// ---------- Start up ----------
function setupToday() {
  const slider = $('#formality');
  const labels = ['', 'Very casual', 'Casual', 'Smart casual', 'Smart', 'Very smart'];
  const showValue = () => { $('#formalityValue').textContent = labels[slider.value]; };
  slider.value = state.prefs.formality;
  showValue();
  slider.addEventListener('input', showValue);
  slider.addEventListener('change', () => {
    state.prefs.formality = Number(slider.value);
    db.savePrefs(state.prefs);
    recompute({ keepPick: false });
  });
  $('#tryNew').checked = state.prefs.tryNew;
  $('#tryNew').addEventListener('change', e => {
    state.prefs.tryNew = e.target.checked;
    db.savePrefs(state.prefs);
    recompute({ keepPick: false });
  });
  $('#reshuffleBtn').addEventListener('click', reshuffle);
  $('#wearBtn').addEventListener('click', wearCurrent);
  $('#todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  [state.items, state.wears] = await Promise.all([db.getAll('items'), db.getAll('wears')]);

  document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => showScreen(b.dataset.screen)));
  $('#addItemBtn').addEventListener('click', () => openEditor());
  $('#laundryBtn').addEventListener('click', laundryDone);
  setupToday();
  setupEditor();
  setupSettings();
  renderWardrobe();

  recompute();          // show something straight away…
  await loadWeather();  // …then update once the weather arrives
}

init().catch(err => {
  document.body.prepend(el('p', { style: 'padding:16px;color:#B3412E' }, `Something went wrong starting the app: ${err.message}`));
});
