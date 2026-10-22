// Host-App: Anmeldung, Spiel anlegen, Seiten Spieler / Rezeption / Spiel.
import { startRibbons } from "./ribbons.js?v=202610222334";
import { auth, db, HOST_UID, APP_URL } from "./fb.js?v=202610222334";
import { initRound } from "./host-round.js?v=202610222334";
import { initLobby } from "./host-lobby.js?v=202610222334";
import { buzzerList, matchBuzzer, playBuzzer } from "./buzzer.js?v=202610222334";
import { shrink } from "./images.js?v=202610222334";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, get, set, update, remove, onValue, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

startRibbons();
const $ = (id) => document.getElementById(id);
const VIEWS = ["v-login", "v-nohost", "v-new", "v-spieler", "v-rezeption", "v-warteseite", "v-spiel"];
const show = (v) => VIEWS.forEach((id) => $(id).classList.toggle("hidden", id !== v));
const err = (t) => { $("error").textContent = t || ""; $("error").classList.toggle("hidden", !t); };
const store = {
  get() { try { return localStorage.getItem("sqz-host-game"); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem("sqz-host-game", v) : localStorage.removeItem("sqz-host-game"); } catch {} },
};
const cleanName = (n) => n.replace(/[.#$\[\]\/]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
const keyOf = (n) => cleanName(n).toLowerCase();
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => ALPH[n % ALPH.length]).join("");

let game = null, unsub = [], pub = {}, roster = {}, claims = {}, presence = {}, teams = {}, nameIndex = {}, away = {};
let isHost = false, boardMode = "players", lobbyStarted = false, buzzers = null;
buzzerList().then((l) => { buzzers = l; renderPlayers(); });
/** Welche Buzzer-Datei gilt für diesen Spieler? (Auswahl > automatisch > Sprachausgabe) */
export function buzzerFor(p) { if (p.buzzer === "__tts") return null; return p.buzzer || matchBuzzer(p.name, buzzers || []); }
const G = () => `games/${game}`;

const roundCtl = initRound({
  game: () => game, roster: () => roster, claims: () => claims, err,
  onResults: () => renderBoard(), active: () => tab() === "spiel",
  left: () => away, buzzerFor: (p) => buzzerFor(p),
});

// ---------- Anmeldung ----------
onAuthStateChanged(auth, async (user) => {
  isHost = !!user && !user.isAnonymous && user.uid === HOST_UID;
  $("who").textContent = user && !user.isAnonymous ? (user.displayName || user.email) : "";
  $("who").classList.toggle("hidden", !user || user.isAnonymous);
  if (!user || user.isAnonymous) return show("v-login");
  if (!isHost) return show("v-nohost");
  if (!lobbyStarted) { lobbyStarted = true; initLobby(err); }
  const saved = store.get();
  if (saved && (await get(ref(db, `games/${saved}/public`))).exists()) openGame(saved);
  else { store.set(null); noGame(); }
});
$("login").addEventListener("click", async () => {
  err(""); try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { err("Anmeldung fehlgeschlagen: " + (e.code || e.message)); }
});
document.querySelectorAll(".logout").forEach((b) => b.addEventListener("click", () => signOut(auth)));

function noGame() { game = null; $("tabs").classList.add("hidden"); $("game-badge").classList.add("hidden"); show("v-new"); }

// ---------- Spiel anlegen ----------
$("create").addEventListener("click", async () => {
  err("");
  const btn = $("create"); btn.disabled = true; btn.textContent = "Wird angelegt …";
  try {
    let code;
    const wish = $("wish").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (wish) {
      if (wish.length < 4 || /[01IO]/.test(wish)) throw new Error("Der Wunschcode braucht 4–6 Zeichen ohne 0, 1, I und O.");
      if ((await get(ref(db, `games/${wish}/public`))).exists()) throw new Error("Unter diesem Code läuft schon ein Spiel.");
      code = wish;
    } else { do { code = newCode(); } while ((await get(ref(db, `games/${code}/public`))).exists()); }
    await set(ref(db, `games/${code}`), { public: { state: "lobby", title: $("new-title").value.trim() || "SQUIZZZzZ", allowGuests: true, createdAt: serverTimestamp() } });
    store.set(code); location.hash = "#spieler"; openGame(code);
  } catch (e) { err(e.code ? "Spiel konnte nicht angelegt werden: " + e.code : e.message); }
  finally { btn.disabled = false; btn.textContent = "Spiel anlegen"; }
});

// ---------- Spiel öffnen ----------
function openGame(code) {
  game = code;
  unsub.forEach((u) => u()); unsub = [];
  $("tabs").classList.remove("hidden");
  $("game-badge").textContent = code; $("game-badge").classList.remove("hidden");
  $("code").textContent = code;
  const qr = qrcode(0, "M"); qr.addData(APP_URL + "?g=" + code); qr.make();
  $("qr").innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  const on = (path, fn) => unsub.push(onValue(ref(db, `${G()}/${path}`), (s) => { fn(s.val()); renderAll(); }));
  on("public", (v) => { pub = v || {}; subscribeAway(); });
  on("roster", (v) => { roster = v || {}; repairIndex(); });
  on("claims", (v) => (claims = v || {}));
  on("presence", (v) => (presence = v || {}));
  on("teams", (v) => (teams = v || {}));
  on("nameIndex", (v) => { nameIndex = v || {}; repairIndex(); });
  roundCtl.attach();
  route();
}
let awayUnsub = null, awayQid = null;
function subscribeAway() {
  if (pub.questionId === awayQid) return;
  awayUnsub && awayUnsub(); awayQid = pub.questionId || null; away = {};
  if (awayQid) awayUnsub = onValue(ref(db, `${G()}/away/${awayQid}`), (s) => { away = s.val() || {}; roundCtl.render(); });
}

// Namensverzeichnis reparieren: jeder Name aus der Liste muss im Verzeichnis stehen (Schutz vor Doppelten)
let repairing = false;
async function repairIndex() {
  if (repairing || !game) return;
  const fix = {};
  Object.values(roster).forEach((p) => { const k = keyOf(p.name || ""); if (k && !nameIndex[k] && !fix[`nameIndex/${k}`]) fix[`nameIndex/${k}`] = HOST_UID; });
  if (!Object.keys(fix).length) return;
  repairing = true; try { await update(ref(db, G()), fix); } finally { repairing = false; }
}

// ---------- Seiten ----------
const tab = () => (location.hash || "#rezeption").slice(1);
function route() {
  if (!game) return;
  const t = ["spieler", "rezeption", "warteseite", "spiel"].includes(tab()) ? tab() : "rezeption";
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === t));
  show("v-" + t); renderAll();
}
addEventListener("hashchange", route);

function renderAll() { if (!game) return; renderPlayers(); renderTeams(); renderReception(); renderBoard(); roundCtl.render(); }

// ---------- Spieler ----------
$("add-btn").addEventListener("click", async () => {
  const names = $("add-names").value.split("\n").map(cleanName).filter(Boolean);
  if (!names.length) return;
  const upd = {}, skipped = [], seen = new Set();
  names.forEach((n, i) => {
    const k = n.toLowerCase();
    if (nameIndex[k] || seen.has(k)) return skipped.push(n);
    seen.add(k);
    const pid = "p" + Date.now().toString(36) + i;
    upd[`roster/${pid}`] = { name: n };
    upd[`nameIndex/${k}`] = HOST_UID;
  });
  if (Object.keys(upd).length) await update(ref(db, G()), upd);
  $("add-names").value = "";
  $("add-msg").textContent = skipped.length ? `Schon vorhanden, nicht doppelt angelegt: ${skipped.join(", ")}` : "";
  $("add-msg").classList.toggle("hidden", !skipped.length);
});

function confirmBtn(b, label, fn) {
  b.addEventListener("click", () => {
    if (b.dataset.c !== "1") { b.dataset.c = "1"; b.textContent = "Sicher?"; setTimeout(() => { b.dataset.c = ""; b.textContent = label; }, 3000); return; }
    fn();
  });
}

async function removePlayer(pid) {
  const p = roster[pid]; if (!p) return;
  const k = keyOf(p.name), upd = { [`roster/${pid}`]: null, [`claims/${pid}`]: null };
  const owner = nameIndex[k];
  // Verzeichnis-Eintrag nur löschen, wenn kein anderer Spieler denselben Namen trägt
  const others = Object.entries(roster).filter(([id, x]) => id !== pid && keyOf(x.name) === k).length;
  if (!others && owner) upd[`nameIndex/${k}`] = null;
  await update(ref(db, G()), upd);
}

function renderPlayers() {
  if (!game) return;
  const tb = $("p-rows"); tb.innerHTML = "";
  const count = {}; Object.values(roster).forEach((p) => { const k = keyOf(p.name); count[k] = (count[k] || 0) + 1; });
  const teamOpts = Object.entries(teams).sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
  Object.entries(roster).sort((a, b) => a[1].name.localeCompare(b[1].name, "de")).forEach(([pid, p]) => {
    const uid = claims[pid], online = !!(uid && presence[uid]);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="status-dot ${online ? "on" : ""}"></span></td><td class="n"></td><td></td><td class="bz"></td><td class="small"></td><td class="actions"></td>`;
    const nm = tr.children[1]; nm.textContent = p.name;
    if (p.guest) nm.insertAdjacentHTML("beforeend", `<span class="tag new">neu</span>`);
    if (count[keyOf(p.name)] > 1) nm.insertAdjacentHTML("beforeend", `<span class="tag warn">doppelt</span>`);
    const sel = document.createElement("select"); sel.className = "team-sel";
    sel.innerHTML = `<option value="">– keine –</option>` + teamOpts.map(([tid, t]) => `<option value="${tid}"></option>`).join("");
    teamOpts.forEach(([tid, t], i) => (sel.options[i + 1].textContent = t.name));
    sel.value = p.team && teams[p.team] ? p.team : "";
    sel.addEventListener("change", () => set(ref(db, `${G()}/roster/${pid}/team`), sel.value || null));
    tr.children[2].appendChild(sel);
    // Buzzername: automatisch zugeordnet, änderbar; ▶ zum Probehören
    const files = buzzers || [], auto = matchBuzzer(p.name, files);
    const bz = document.createElement("select");
    bz.innerHTML = `<option value="">${auto ? "Auto: " + auto : "Auto: Stimme"}</option><option value="__tts">Stimme (Mac)</option>` + files.map((f) => `<option></option>`).join("");
    files.forEach((f, i) => { bz.options[i + 2].value = f; bz.options[i + 2].textContent = f; });
    bz.value = p.buzzer || "";
    bz.addEventListener("change", () => set(ref(db, `${G()}/roster/${pid}/buzzer`), bz.value || null));
    const play = document.createElement("button"); play.className = "btn secondary small"; play.textContent = "▶"; play.title = "Probehören";
    play.style.marginLeft = "6px"; play.onclick = () => playBuzzer(buzzerFor(p), p.name);
    tr.children[3].append(bz, play);
    tr.children[4].textContent = uid ? (online ? "online" : "angemeldet, offline") : "noch nicht da";
    const acts = tr.children[5];
    if (uid) { const b = document.createElement("button"); b.className = "btn secondary small"; b.textContent = "Abmelden"; b.title = "Spieler abmelden – der Name wird wieder frei"; b.onclick = () => remove(ref(db, `${G()}/claims/${pid}`)); acts.appendChild(b); }
    const x = document.createElement("button"); x.className = "btn danger small"; x.textContent = "Entfernen"; confirmBtn(x, "Entfernen", () => removePlayer(pid)); acts.appendChild(x);
    tb.appendChild(tr);
  });
  if (!Object.keys(roster).length) tb.innerHTML = `<tr><td></td><td colspan="4" class="small">Noch keine Spieler – oben Namen eintragen, oder die Spieler tragen sich an der Rezeption selbst ein.</td></tr>`;
}

// ---------- Gruppen ----------
$("team-add").addEventListener("click", async () => {
  const name = $("team-name").value.trim().slice(0, 30); if (!name) return;
  await set(ref(db, `${G()}/teams/t${Date.now().toString(36)}`), { name });
  $("team-name").value = "";
});
$("team-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("team-add").click(); });

function renderTeams() {
  const box = $("team-list"); box.innerHTML = "";
  const members = {}; Object.values(roster).forEach((p) => p.team && (members[p.team] = (members[p.team] || 0) + 1));
  Object.entries(teams).sort((a, b) => a[1].name.localeCompare(b[1].name, "de")).forEach(([tid, t]) => {
    const el = document.createElement("div"); el.className = "team";
    el.innerHTML = `<label class="logo" title="Logo hochladen"><input type="file" accept="image/*" class="hidden">${t.logo ? "" : "Logo<br>hochladen"}</label>
      <div><input class="tname" maxlength="30"><div class="meta">${members[tid] || 0} Spieler</div></div><button class="btn danger small">Löschen</button>`;
    if (t.logo) el.querySelector(".logo").style.backgroundImage = `url("${t.logo}")`;
    const inp = el.querySelector(".tname"); inp.value = t.name;
    inp.addEventListener("change", () => inp.value.trim() && set(ref(db, `${G()}/teams/${tid}/name`), inp.value.trim().slice(0, 30)));
    el.querySelector("input[type=file]").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await set(ref(db, `${G()}/teams/${tid}/logo`), await shrink(f, 256, "image/png")); } catch (ex) { err(ex.message); }
    });
    confirmBtn(el.querySelector("button"), "Löschen", async () => {
      const upd = { [`teams/${tid}`]: null };
      Object.entries(roster).forEach(([pid, p]) => p.team === tid && (upd[`roster/${pid}/team`] = null));
      await update(ref(db, G()), upd);
    });
    box.appendChild(el);
  });
  if (!Object.keys(teams).length) box.innerHTML = `<p class="small">Noch keine Gruppen.</p>`;
}

// ---------- Rezeption ----------
$("allow-guests").addEventListener("change", (e) => set(ref(db, `${G()}/public/allowGuests`), e.target.checked));
function renderReception() {
  $("allow-guests").checked = pub.allowGuests === true;
  let nIn = 0, nOn = 0; const list = $("rec-list"); list.innerHTML = "";
  Object.entries(roster).sort((a, b) => a[1].name.localeCompare(b[1].name, "de")).forEach(([pid, p]) => {
    const uid = claims[pid], online = !!(uid && presence[uid]); if (uid) nIn++; if (online) nOn++;
    const li = document.createElement("li"); li.innerHTML = `<span class="status-dot ${online ? "on" : ""}"></span><span></span>`;
    li.lastChild.textContent = p.name + (uid ? "" : " · noch nicht da"); list.appendChild(li);
  });
  $("c-in").textContent = nIn; $("c-on").textContent = nOn; $("c-all").textContent = Object.keys(roster).length;
}
function qrSvg() {
  const qr = qrcode(0, "M"); qr.addData(APP_URL + "?g=" + game); qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + 2 * q; let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + q},${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
$("qr-svg").addEventListener("click", () => download(new Blob([qrSvg()], { type: "image/svg+xml" }), `SQUIZZZzZ-QR-${game}.svg`));
$("qr-png").addEventListener("click", () => {
  const img = new Image(), px = 2048;
  img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = px; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(img, 0, 0, px, px); c.toBlob((b) => download(b, `SQUIZZZzZ-QR-${game}.png`), "image/png"); };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg());
});
confirmBtn($("end"), "Spiel beenden & löschen", async () => {
  unsub.forEach((u) => u()); unsub = []; roundCtl.detach(); awayUnsub && awayUnsub();
  await remove(ref(db, G())).catch((e) => err("Löschen fehlgeschlagen: " + e.code));
  store.set(null); location.hash = ""; noGame();
});

// ---------- Spielseite links: Spieler / Gruppen mit Punkten ----------
$("sb-players").addEventListener("click", () => { boardMode = "players"; renderBoard(); });
$("sb-teams").addEventListener("click", () => { boardMode = "teams"; renderBoard(); });
$("sb-show").addEventListener("change", () => renderBoard());
function renderBoard() {
  if (!game) return;
  $("sb-players").classList.toggle("on", boardMode === "players");
  $("sb-teams").classList.toggle("on", boardMode === "teams");
  const showPts = $("sb-show").checked, t = roundCtl.totals(), box = $("board"); box.innerHTML = "";
  const fmt = (v) => (showPts ? (Math.round(v * 10) / 10).toString().replace(".", ",") : "•••");
  if (boardMode === "players") {
    const rows = Object.entries(roster).map(([pid, p]) => ({ pid, name: p.name, pts: t[pid] || 0, online: !!(claims[pid] && presence[claims[pid]]) }));
    rows.sort((a, b) => (showPts ? b.pts - a.pts : 0) || a.name.localeCompare(b.name, "de"));
    rows.forEach((r) => { const li = document.createElement("li"); li.innerHTML = `<span class="status-dot ${r.online ? "on" : ""}"></span><span class="nm"></span><span class="pts">${fmt(r.pts)}</span>`; li.querySelector(".nm").textContent = r.name; box.appendChild(li); });
  } else {
    // Gruppenpunkte: Durchschnitt pro Spieler (gleiche Gewichtung unabhängig von der Gruppengröße; endgültige Formel noch offen)
    const rows = Object.entries(teams).map(([tid, tm]) => {
      const mem = Object.entries(roster).filter(([, p]) => p.team === tid);
      const sum = mem.reduce((s, [pid]) => s + (t[pid] || 0), 0);
      return { name: tm.name, logo: tm.logo, n: mem.length, pts: mem.length ? sum / mem.length : 0 };
    });
    rows.sort((a, b) => (showPts ? b.pts - a.pts : 0) || a.name.localeCompare(b.name, "de"));
    rows.forEach((r) => { const li = document.createElement("li"); li.className = "team-row"; li.innerHTML = `<span class="mini"></span><span class="nm"></span><span class="pts">${fmt(r.pts)}</span>`; if (r.logo) li.querySelector(".mini").style.backgroundImage = `url("${r.logo}")`; li.querySelector(".nm").textContent = `${r.name} (${r.n})`; box.appendChild(li); });
    if (!rows.length) box.innerHTML = `<li class="small" style="display:block">Noch keine Gruppen – auf der Seite „Spieler“ anlegen.</li>`;
  }
}
