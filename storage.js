// Saving data on your phone.
//  - Clothes (with photos) and wear history go in IndexedDB, the browser's
//    built-in database, which can hold photos.
//  - Small preferences (slider position, town, toggles) go in localStorage.
//  - Export/import turns everything into one .json backup file and back.

const DB_NAME = 'outfit-picker';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('wears')) db.createObjectStore('wears', { keyPath: 'date' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = store => run(store, 'readonly', tx => tx.objectStore(store).getAll());
export const put = (store, value) => run(store, 'readwrite', tx => tx.objectStore(store).put(value));
export const remove = (store, key) => run(store, 'readwrite', tx => tx.objectStore(store).delete(key));
export const clearStore = store => run(store, 'readwrite', tx => tx.objectStore(store).clear());

// ---------- Preferences ----------
const PREFS_KEY = 'outfit-prefs';
const DEFAULT_PREFS = { useGps: true, town: null, formality: 3, tryNew: false, debug: false, todayPick: null };

export function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage full or blocked */ }
}

// ---------- Backup ----------
const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function exportBackup(prefs) {
  const [items, wears] = await Promise.all([getAll('items'), getAll('wears')]);
  const outItems = [];
  for (const it of items) outItems.push({ ...it, photo: it.photo ? await blobToDataUrl(it.photo) : null });
  const backup = {
    app: 'outfit-picker',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: outItems,
    wears,
    prefs: { useGps: prefs.useGps, town: prefs.town },
  };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function readBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error("That file isn't a valid backup."); }
  if (data?.app !== 'outfit-picker' || !Array.isArray(data.items)) throw new Error("That file isn't an Outfit Picker backup.");
  const items = [];
  for (const it of data.items) {
    items.push({ ...it, photo: it.photo ? await (await fetch(it.photo)).blob() : null });
  }
  return { items, wears: Array.isArray(data.wears) ? data.wears : [], prefs: data.prefs || {} };
}

// Replace everything in one go, so a failed import can't leave a half-done wardrobe.
export async function replaceAll(items, wears) {
  await run(['items', 'wears'], 'readwrite', tx => {
    const is = tx.objectStore('items'), ws = tx.objectStore('wears');
    is.clear(); ws.clear();
    items.forEach(i => is.put(i));
    wears.forEach(w => ws.put(w));
  });
}
