const isHost = location.pathname.includes("/host/");
let user = null; const cbs = [];
function getUid() { let u = sessionStorage.getItem("fakeuid"); if (!u) { u = "anon_" + Math.random().toString(36).slice(2, 8); sessionStorage.setItem("fakeuid", u); } return u; }
export const getAuth = () => ({});
export class GoogleAuthProvider {}
export function onAuthStateChanged(a, cb) { cbs.push(cb); setTimeout(() => cb(user), 50); return () => {}; }
function setUser(u) { user = u; cbs.forEach((c) => c(u)); }
export async function signInAnonymously() { setUser({ uid: getUid(), isAnonymous: true }); }
export async function signInWithPopup() { setUser({ uid: "JIXlQDiywfTPFhtg6I2Ki2uAc7D2", isAnonymous: false, displayName: "Test Host", email: "host@test" }); }
export async function signOut() { setUser(null); }
if (isHost) setTimeout(() => signInWithPopup(), 10);
