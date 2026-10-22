const KEY = "fakedb", TS = { ".sv": "timestamp" };
const load = () => JSON.parse(localStorage.getItem(KEY) || "{}");
const parts = (p) => p.split("/").filter(Boolean);
function getAt(o, p) { for (const k of parts(p)) { if (o == null) return null; o = o[k]; } return o === undefined ? null : o; }
function resolveTs(v) { if (v && typeof v === "object") { if (v[".sv"] === "timestamp") return Date.now(); for (const k of Object.keys(v)) { v[k] = resolveTs(v[k]); if (v[k] === null) delete v[k]; } if (!Object.keys(v).length) return null; } return v; }
function setAt(root, p, v) {
  const ks = parts(p); if (!ks.length) return v;
  let o = root; for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== "object" || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; }
  if (v === null || v === undefined) delete o[ks.at(-1)]; else o[ks.at(-1)] = v; return root;
}
const listeners = [];
function snap(v) { return { exists: () => v !== null && v !== undefined, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) }; }
function notify() { const db = load(); listeners.forEach((l) => { const v = JSON.stringify(getAt(db, l.path)); if (v !== l.last) { l.last = v; l.cb(snap(getAt(db, l.path))); } }); }
addEventListener("storage", (e) => { if (e.key === KEY) notify(); });
function write(fn) { const db = load(); const out = fn(db) || db; localStorage.setItem(KEY, JSON.stringify(out)); setTimeout(notify, 0); }
export const getDatabase = () => ({});
export const ref = (db, path) => ({ path });
export const serverTimestamp = () => TS;
export function onValue(r, cb) { const l = { path: r.path, cb, last: undefined }; listeners.push(l); setTimeout(notify, 20); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; }
export async function get(r) { return snap(getAt(load(), r.path)); }
export async function set(r, v) { write((db) => setAt(db, r.path, resolveTs(JSON.parse(JSON.stringify(v ?? null))))); }
export async function update(r, obj) { write((db) => { for (const [k, v] of Object.entries(obj)) setAt(db, r.path + "/" + k, resolveTs(JSON.parse(JSON.stringify(v ?? null)))); return db; }); }
export async function remove(r) { write((db) => setAt(db, r.path, null)); }
export const onDisconnect = () => ({ remove() {} });
export const goOffline = () => {}, goOnline = () => {};
