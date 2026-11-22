// Template library: store a real .cvj per cabinet type (by its type code) in
// IndexedDB, so the catalog can generate a manufacturable .cvj at any size without
// bundling large templates. Templates can be ~15 MB → IndexedDB (not localStorage).

const DB = 'cvjkit', STORE = 'templates', VER = 1;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); const st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  }));
}

// save a template: code (cabinet type, e.g. "D-1KS_S-3ZAS") → { bytes, name, W,H,D, savedAt }
export function saveTemplate(code, rec) { return tx('readwrite', (st) => st.put(rec, code)); }
export function getTemplate(code) { return tx('readonly', (st) => st.get(code)); }
export function deleteTemplate(code) { return tx('readwrite', (st) => st.delete(code)); }
// list stored template codes (keys) — for showing which catalog types are generatable
export function listTemplates() {
  return open().then((db) => new Promise((resolve, reject) => {
    const st = db.transaction(STORE, 'readonly').objectStore(STORE);
    const req = st.getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
