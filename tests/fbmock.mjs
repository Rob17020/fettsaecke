// Mini-Firebase für Playwright: wird per page.route statt der echten SDK-Module von gstatic ausgeliefert.
// Zustand in window.__FBM = { user, store: { 'players/me': {...} }, writes: [] }
export const MODULES = {
  'firebase-app.js': `export const initializeApp = c => ({ c });`,
  'firebase-auth.js': `const M = window.__FBM;
export const getAuth = () => ({});
export const onAuthStateChanged = (a, cb) => { M.authCb = cb; setTimeout(() => cb(M.user), 0); };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => { M.user = { uid: 'me', displayName: 'Robbi Test' }; M.authCb(M.user); };
export const signInWithRedirect = signInWithPopup;
export const signOut = async () => { M.user = null; M.authCb(null); };`,
  'firebase-firestore.js': `const M = window.__FBM; M.listeners = []; M.writes = M.writes || [];
export const getFirestore = () => ({});
export const collection = (db, name) => ({ kind: 'col', path: name });
export const doc = (db, ...s) => ({ kind: 'doc', path: s.join('/') });
export const serverTimestamp = () => ({ __ts: 1 });
export const deleteField = () => ({ __del: 1 });
export const Timestamp = { fromMillis: ms => ms };
export class FieldPath { constructor(...s) { this.s = s; } }
const clean = v => { if (v && typeof v === 'object' && !Array.isArray(v)) { if (v.__ts) return Date.now(); const o = {}; for (const [k, x] of Object.entries(v)) if (!(x && x.__del)) o[k] = clean(x); return o; } return Array.isArray(v) ? v.map(clean) : v; };
const deep = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? deep(a[k], v) : v; return o; };
const emit = () => M.listeners.slice().forEach(f => f());
export function onSnapshot(ref, a, b, c) {
  const hasOpts = a && typeof a === 'object' && typeof a !== 'function', next = hasOpts ? b : a;
  const fire = () => {
    if (ref.kind === 'doc') { const d = M.store[ref.path]; next({ exists: () => d !== undefined, data: () => d && structuredClone(d), metadata: { hasPendingWrites: false } }); }
    else { const docs = Object.keys(M.store).filter(k => k.split('/').length === 2 && k.startsWith(ref.path + '/')).map(k => ({ id: k.split('/')[1], data: () => structuredClone(M.store[k]) })); next({ forEach: f => docs.forEach(f) }); }
  };
  M.listeners.push(fire); setTimeout(fire, 0); return () => { M.listeners = M.listeners.filter(x => x !== fire); };
}
export async function setDoc(ref, data, opt) { M.writes.push({ op: 'set', path: ref.path, data: clean(data) }); M.store[ref.path] = opt?.merge ? deep(M.store[ref.path] || {}, clean(data)) : clean(data); emit(); }
export async function updateDoc(ref, data) { M.writes.push({ op: 'update', path: ref.path, data: clean(data) }); if (!M.store[ref.path]) throw Object.assign(new Error('nf'), { code: 'not-found' }); M.store[ref.path] = { ...M.store[ref.path], ...clean(data) }; for (const [k, v] of Object.entries(data)) if (v && v.__del) delete M.store[ref.path][k]; emit(); }
export async function getDoc(ref) { const d = M.store[ref.path]; return { exists: () => d !== undefined, data: () => d && structuredClone(d) }; }
export async function deleteDoc(ref) { M.writes.push({ op: 'delete', path: ref.path }); delete M.store[ref.path]; emit(); }
export function writeBatch() { const ops = []; return { set: (r, d, o) => ops.push(() => setDoc(r, d, o)), update: (r, d) => ops.push(() => updateDoc(r, d)), delete: r => ops.push(() => deleteDoc(r)), commit: async () => { for (const o of ops) await o(); } }; }`,
};
