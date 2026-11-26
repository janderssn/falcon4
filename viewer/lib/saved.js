// Saved gliders: a name, a small picture and the glider as a link's query (model, design, cloths, nose
// cone, frame: what "Copy link to this glider" carries, without the view). Kept in this browser's
// local storage: no account, per browser and device.
const KEY = 'falcon4.saved-gliders.v1';

export function savedGliders() {
  try { const list = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(list) ? list.filter((g) => g && g.id && g.q) : []; }
  catch { return []; }
}
/** Stores the list; false when the browser refuses (private mode, storage full). */
function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
/** Adds a glider (newest first); returns it, or null when it could not be stored. */
export function saveGlider(name, q, img) {
  const g = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, q, img };
  return store([g, ...savedGliders()]) ? g : null;
}
export function renameGlider(id, name) {
  const list = savedGliders(), g = list.find((x) => x.id === id);
  if (g && name) { g.name = name; store(list); }
}
export function deleteGlider(id) { store(savedGliders().filter((g) => g.id !== id)); }
