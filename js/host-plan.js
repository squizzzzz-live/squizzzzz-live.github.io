// Regieplan: den Abend vorbereiten (Reiter „Regieplan“) und im Pult Schritt für Schritt abarbeiten (Leiste im Reiter „Spiel“).
// Ein Block ist Film, Moderation, Runde, Pause oder Siegerverkündung. Runden zeigen auf eine Datei im Ordner SQUIZZZzZ,
// die das Pult (Mac-App) erst beim Start der Runde liest. QLab kommt in P3 dazu.
import { db } from "./fb.js?v=202610240008";
import { parseSpeedquizzing } from "./sqq.js?v=202610240008";
import { shrink } from "./images.js?v=202610240008";
import { buildSpec, fill, countCues } from "./qlab.js?v=202610240008";
import { isMac, readText, readBlob, listDir } from "./mac.js?v=202610240008";
import { ref, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const KINDS = {
  film: { label: "Film", icon: "🎬" },
  moderation: { label: "Moderation", icon: "🎤" },
  runde: { label: "Runde", icon: "🎯" },
  leinwand: { label: "Leinwand", icon: "🖼" },
  pause: { label: "Pause", icon: "☕" },
  sieger: { label: "Siegerverkündung", icon: "🏆" },
};
const DEFAULT_TITLE = { film: "Film", moderation: "Moderation", runde: "", leinwand: "Leinwand", pause: "Große Pause", sieger: "Siegerverkündung" };
// Standardpfade (relativ zum Ordner SQUIZZZzZ) – vorläufig, Martin überarbeitet sie noch (23.10.2026). Je Regieplan überschreibbar.
export const BUILTIN = {
  saverFilm: "01 Trailer/12 Intermezzo/Sparkling Blue Background.mp4",
  saverStill: "01 Trailer/12 Intermezzo/Standbild Sparkling Background.jpg",
  pauseFilm: "01 Trailer/14 Jovis tanzt/Jovis tanzt_V1.1.mp4",
};
const DEFAULT_LABEL = { saverFilm: "Bildschirmschoner-Film", saverStill: "Standbild", pauseFilm: "Pausenfilm" };
const FILTERS = {
  round: /\.(sqq|sqb|sqn)$/i,
  image: /\.(jpe?g|png|gif|webp|tiff?|heic)$/i,
  video: /\.(mp4|mov|m4v)$/i,
  audio: /\.(mp3|wav|aiff?|m4a|aac)$/i,
  media: /\.(mp4|mov|m4v|mp3|wav|aiff?|m4a|aac|jpe?g|png)$/i,
};
const fileName = (p) => (p || "").split("/").pop();
const sortNames = (a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
const titleFromFile = (path) => (path.split("/").pop() || "").replace(/\.(sqq|sqb|sqn)$/i, "").replace(/^\d+[_ ]*/, "").replace(/_/g, " ").trim();
const titleOf = (b) => b ? (b.title || (b.type === "runde" && b.file ? titleFromFile(b.file) : "") || KINDS[b.type]?.label || "Block") : "";
const kindOf = (b) => KINDS[b?.type] || { label: "Block", icon: "•" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export function initPlan(ctx) {
  // ctx: { game(), err(msg), round (Rundensteuerung), active() → Reiter „Spiel“ offen?, gameTitle() }
  let blocks = [], pos = -1, done = {}, defaults = {}, qlabState = null, unsub = null;
  let checks = {}, loadError = "", loading = false, busy = false, pendingEditorRender = false;
  const P = () => `games/${ctx.game()}/private/plan`;

  function attach() {
    detach();
    unsub = onValue(ref(db, P()), (s) => {
      const v = s.val() || {};
      blocks = (Array.isArray(v.blocks) ? v.blocks : Object.values(v.blocks || {})).filter(Boolean);
      pos = typeof v.pos === "number" ? v.pos : -1;
      done = v.done || {};
      defaults = v.defaults || {};
      qlabState = v.qlab || null;
      renderEditor(); renderDefaults(); renderQlab(); renderBar();
    });
  }
  function detach() { unsub && unsub(); unsub = null; blocks = []; pos = -1; done = {}; checks = {}; loadError = ""; }

  const saveBlocks = () => set(ref(db, `${P()}/blocks`), blocks.map((b) => JSON.parse(JSON.stringify(b))));

  // ---------- Vorbereitung: Blöcke bearbeiten ----------
  function addBlock(type) {
    const b = { id: "b" + Date.now().toString(36), type, title: DEFAULT_TITLE[type] || "", notes: "", reserve: false };
    if (type === "runde") Object.assign(b, { file: "", image: "", explain: "", mediaType: "none", clipsDir: "", solveDir: "", s: { duration: 20, lockWho: "player", lockLen: 2, sendq: true } });
    if (type === "film" || type === "sieger") b.media = "";
    if (type === "leinwand") Object.assign(b, { film: "", still: "" });
    if (type === "pause") Object.assign(b, { media: "", thenCanvas: true });
    blocks.push(b); saveBlocks();
  }
  document.querySelectorAll("[data-add-block]").forEach((btn) => btn.addEventListener("click", () => addBlock(btn.dataset.addBlock)));

  function setField(b, k, v) {
    if (k.startsWith("s.")) { b.s = b.s || {}; const key = k.slice(2); if (v === "" || v === null) delete b.s[key]; else b.s[key] = v; }
    else b[k] = v;
    if (k === "type" && v === "runde" && !b.s) Object.assign(b, { file: b.file || "", image: b.image || "", s: { duration: 20, lockWho: "player", lockLen: 2, sendq: true } });
  }

  const list = $("plan-list");
  list.addEventListener("change", (e) => {
    const el = e.target, card = el.closest("[data-i]"); if (!card || !el.dataset.k) return;
    const b = blocks[+card.dataset.i]; if (!b) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number") v = el.value === "" ? "" : Math.max(0, parseInt(el.value, 10) || 0);
    if (el.dataset.k === "s.lockLen") v = parseInt(v, 10) || 2;
    if (["file", "image", "explain", "clipsDir", "solveDir", "media", "film", "still"].includes(el.dataset.k)) v = relPath(v);
    setField(b, el.dataset.k, v);
    if (el.dataset.k === "file") delete checks[b.id];
    saveBlocks();
    if (el.dataset.k === "type" || el.dataset.k === "mediaType") { pendingEditorRender = false; renderEditor(true); }
  });
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]"), card = e.target.closest("[data-i]"); if (!btn || !card) return;
    const i = +card.dataset.i, b = blocks[i]; if (!b) return;
    const act = btn.dataset.act;
    if (act === "up" && i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; await fixPosAfterMove(i, i - 1); saveBlocks(); }
    if (act === "down" && i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; await fixPosAfterMove(i, i + 1); saveBlocks(); }
    if (act === "del") {
      if (btn.dataset.c !== "1") { btn.dataset.c = "1"; btn.textContent = "Sicher?"; setTimeout(() => { btn.dataset.c = ""; btn.textContent = "✕"; }, 3000); return; }
      blocks.splice(i, 1); if (pos >= i && pos > -1) await update(ref(db, P()), { pos: pos === i ? -1 : pos - 1 }); saveBlocks();
    }
    if (act === "browse") {
      const key = btn.dataset.key, mode = btn.dataset.mode || "file";
      const start = b[key] || (mode === "dir" ? (b.clipsDir || b.file || b.explain) : (b.file || b.explain || b.clipsDir)) || "";
      browse(start, FILTERS[btn.dataset.f] || FILTERS.media, btn.dataset.title || "Datei wählen", (path) => {
        b[key] = path;
        if (key === "file" && !b.title) b.title = titleFromFile(path);
        delete checks[b.id]; saveBlocks(); if (b.type === "runde" && b.file) checkBlock(b);
      }, mode);
    }
    if (act === "clear") { b[btn.dataset.key] = ""; delete checks[b.id]; saveBlocks(); }
    if (act === "check") checkBlock(b);
  });
  async function fixPosAfterMove(from, to) {
    if (pos === from) await update(ref(db, P()), { pos: to });
    else if (pos === to) await update(ref(db, P()), { pos: from });
  }
  list.addEventListener("focusout", () => setTimeout(() => { if (pendingEditorRender && !list.contains(document.activeElement)) renderEditor(); }, 0));

  // Pfade, die Martin als absolute Mac-Pfade einfügt, auf „relativ zu SQUIZZZzZ“ kürzen
  function relPath(v) {
    v = String(v || "").trim().replace(/^file:\/\//, "");
    const m = v.match(/\/Desktop\/SQUIZZZzZ\/(.*)$/); if (m) v = m[1];
    return v.replace(/^\/+/, "").replace(/\/+$/, "");
  }
  const eff = (key) => defaults[key] || BUILTIN[key];
  /** Alle Dateien, die ein Block braucht: [{ label, path, kind: file|dir }] */
  function needs(b) {
    const out = [], add = (label, path, kind = "file") => path && out.push({ label, path, kind });
    if (b.type === "runde") {
      add("Rundendatei", b.file); add("Titelbild", b.image); add("Erklärfilm", b.explain);
      if (b.mediaType === "audio" || b.mediaType === "video") add("Clip-Ordner", b.clipsDir, "dir");
      if (b.mediaType === "video") add("Auflösungs-Ordner", b.solveDir, "dir");
      if (b.mediaType !== "video") { add("Bildschirmschoner", eff("saverFilm")); add("Standbild", eff("saverStill")); }
    }
    if (b.type === "film" || b.type === "sieger") add("Film", b.media);
    if (b.type === "leinwand") { add("Bildschirmschoner", b.film || eff("saverFilm")); add("Standbild", b.still || eff("saverStill")); }
    if (b.type === "pause") { add("Pausenfilm", b.media || eff("pauseFilm")); if (b.thenCanvas !== false) { add("Bildschirmschoner", eff("saverFilm")); add("Standbild", eff("saverStill")); } }
    return out;
  }
  async function clipsIn(dir, kind, cache) {
    const filter = kind === "audio" ? FILTERS.audio : FILTERS.video;
    if (!cache.has(dir)) cache.set(dir, listDir(dir));
    return (await cache.get(dir)).filter((f) => !f.dir && filter.test(f.name)).map((f) => f.name).sort(sortNames);
  }
  async function exists(path, kind, cache) {
    const parent = path.split("/").slice(0, -1).join("/"), name = fileName(path);
    if (!cache.has(parent)) cache.set(parent, listDir(parent).catch(() => []));
    const hit = (await cache.get(parent)).find((f) => f.name === name);
    return !!hit && (kind === "dir" ? hit.dir : !hit.dir);
  }
  async function checkBlock(b, cache = new Map()) {
    checks[b.id] = { pending: true }; renderEditor(true);
    const parts = [], problems = [];
    try {
      if (!isMac()) throw new Error("Prüfen geht nur in der Mac-App „SQUIZZZzZ Pult“.");
      if (b.type === "runde" && !b.file) problems.push("keine Rundendatei eingetragen");
      if ((b.type === "film" || b.type === "sieger") && !b.media) problems.push("kein Film eingetragen");
      for (const n of needs(b)) if (!(await exists(n.path, n.kind, cache))) problems.push(`${n.label} fehlt: ${n.path}`);
      if (b.type === "runde" && b.file && !problems.some((p) => p.startsWith("Rundendatei"))) {
        const parsed = parseSpeedquizzing(await readText(b.file), fileName(b.file));
        ctx.round.assertPlayable(parsed, fileName(b.file));
        const n = parsed.questions.length, pics = parsed.questions.filter((q) => q.picture).length;
        parts.push(`${n} Fragen · ${parsed.mode === "buzzin" ? "Buzzin" : "Keypad"}${pics ? ` · ${pics} mit Bild` : ""}`);
        checks[b.id + ":n"] = n;
        if ((b.mediaType === "audio" || b.mediaType === "video") && b.clipsDir && !problems.some((p) => p.startsWith("Clip-Ordner"))) {
          const clips = await clipsIn(b.clipsDir, b.mediaType, cache);
          if (clips.length === n) parts.push(`${clips.length} Clips passen`); else problems.push(`${clips.length} Clips für ${n} Fragen`);
          checks[b.id + ":clips"] = clips;
        }
        if (b.mediaType === "video" && b.solveDir && !problems.some((p) => p.startsWith("Auflösungs"))) {
          const sol = await clipsIn(b.solveDir, "video", cache);
          parts.push(`${sol.length} Auflösungen`);
          if (sol.length && sol.length !== n) problems.push(`${sol.length} Auflösungen für ${n} Fragen`);
        }
        if (!b.explain) parts.push("ohne Erklärfilm");
      }
      if (!problems.length && !parts.length) parts.push("alle Dateien gefunden");
      checks[b.id] = problems.length ? { ok: false, text: problems.join(" · ") } : { ok: true, text: parts.join(" · ") };
    } catch (e) { checks[b.id] = { ok: false, text: e.message || String(e) }; }
    renderEditor(true);
  }
  $("plan-check").addEventListener("click", async () => {
    if (!blocks.length) { $("plan-check-msg").textContent = "Der Regieplan ist leer."; return; }
    $("plan-check-msg").textContent = "Prüfe …";
    const cache = new Map();
    for (const b of blocks) if (b.type !== "moderation") await checkBlock(b, cache);
    const checked = blocks.filter((b) => b.type !== "moderation"), bad = checked.filter((b) => !checks[b.id]?.ok).length;
    $("plan-check-msg").textContent = bad ? `✗ ${bad} von ${checked.length} Blöcken haben ein Problem – rot markiert.` : `✓ Alle ${checked.length} Blöcke vollständig.`;
  });

  // ---------- QLab befüllen ----------
  const planSig = () => {
    const str = JSON.stringify({ b: blocks.map(({ notes, reserve, s, ...rest }) => rest), d: defaults });
    let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return String(h);
  };
  function renderQlab() {
    const el = $("qlab-state"); if (!el) return;
    if (!qlabState) { el.textContent = "Noch nicht befüllt."; el.className = "small"; return; }
    const t = new Date(qlabState.at).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const changed = qlabState.sig !== planSig();
    el.textContent = `Zuletzt befüllt: ${t}` + (changed ? " · ⚠ Regieplan seitdem geändert – bitte neu befüllen." : " · passt zum Regieplan.");
    el.className = "small " + (changed ? "warn-note" : "ok-note");
  }
  const qCount = new Map();
  async function countQuestions(b) {
    if (checks[b.id + ":n"]) return checks[b.id + ":n"];
    if (!b.file) return 0;
    if (!qCount.has(b.file)) qCount.set(b.file, readText(b.file).then((x) => parseSpeedquizzing(x, fileName(b.file)).questions.length).catch(() => 0));
    return qCount.get(b.file);
  }
  $("qlab-fill").addEventListener("click", async () => {
    const msg = $("qlab-msg"), btn = $("qlab-fill");
    msg.className = "small"; btn.disabled = true;
    try {
      if (!isMac()) throw new Error("QLab befüllen geht nur in der Mac-App „SQUIZZZzZ Pult“.");
      if (ctx.round.info().live) throw new Error("Während eine Runde läuft, befülle ich QLab nicht neu.");
      if (!blocks.length) throw new Error("Der Regieplan ist leer.");
      msg.textContent = "Stelle die Cue-Liste zusammen …";
      const { spec, warn } = await buildSpec(blocks, eff, titleOf, countQuestions);
      const n = countCues(spec);
      if (!n) throw new Error("Im Regieplan steht noch nichts, was QLab abspielen könnte.");
      if (!confirm(`Der QLab-Workspace „SQUIZZZzZ Live“ wird geleert und aus dem Regieplan neu aufgebaut: ${n} Cues.${warn.length ? "\n\nHinweise:\n• " + warn.join("\n• ") : ""}\n\nFortfahren?`)) { msg.textContent = ""; return; }
      const r = await fill(spec, (t) => (msg.textContent = t));
      await update(ref(db, P()), { qlab: { at: Date.now(), sig: planSig(), cues: r.total } });
      const lines = [`✓ ${r.total} Cues in QLab angelegt.`];
      if (r.contLost.length) lines.push(`⚠ „automatisch weiter“ fehlt bei ${r.contLost.join(", ")} – Mac-App aktuell (0.1.4)?`);
      if (r.broken.length) lines.push(`⚠ ${r.broken.length} Cues sind in QLab noch nicht spielbar (meist: Ton- oder Bildausgabe fehlt – siehe Erinnerungsliste): ${r.broken.slice(0, 6).join(", ")}${r.broken.length > 6 ? " …" : ""}`);
      if (warn.length) lines.push("Hinweise: " + warn.join(" · "));
      msg.innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join("");
      msg.className = "small " + (r.broken.length || r.contLost.length ? "warn-note" : "ok-note");
    } catch (e) { msg.textContent = "✗ " + (e.message || e); msg.className = "small bad-note"; }
    finally { btn.disabled = false; }
  });

  // Export / Import (Regieplan als Datei – für den nächsten Abend oder als Vorlage)
  $("plan-export").addEventListener("click", () => {
    const data = { format: "squizzzzz-regieplan", version: 1, title: ctx.gameTitle(), exportedAt: new Date().toISOString(), blocks };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `Regieplan ${ctx.gameTitle() || ctx.game()}.json`.replace(/[\/:]/g, "-");
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $("plan-import").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== "squizzzzz-regieplan" || !Array.isArray(data.blocks)) throw new Error("Das ist keine Regieplan-Datei.");
      if (blocks.length && !confirm(`Den aktuellen Regieplan (${blocks.length} Blöcke) durch „${f.name}“ ersetzen?`)) return;
      blocks = data.blocks.map((b, i) => ({ ...b, id: b.id || "b" + Date.now().toString(36) + i }));
      checks = {};
      await set(ref(db, P()), { blocks, pos: -1, done: null });
    } catch (ex) { ctx.err(ex.message); }
  });

  function pathRow(b, key, label, placeholder, f, title, mode = "file") {
    return `<div class="pb-row"><span class="pb-lbl">${label}</span><input data-k="${key}" class="pb-path" value="${esc(b[key] || "")}" placeholder="${esc(placeholder)}" spellcheck="false">
      <button type="button" class="btn secondary small" data-act="browse" data-key="${key}" data-f="${f}" data-mode="${mode}" data-title="${esc(title)}" ${isMac() ? "" : "disabled"}>${mode === "dir" ? "Ordner …" : "Durchsuchen …"}</button>${b[key] ? `<button type="button" class="ic" data-act="clear" data-key="${key}" title="leeren">✕</button>` : ""}</div>`;
  }
  const chk = (b, ck2) => `<div class="pb-row"><span class="pb-lbl"></span><button type="button" class="btn secondary small" data-act="check">Prüfen</button></div>` + ck2;
  function clipList(b) {
    const clips = checks[b.id + ":clips"]; if (!clips || !clips.length) return "";
    return `<details class="pb-clips"><summary class="small">Zuordnung Frage → Clip anzeigen</summary><ol>${clips.map((c) => `<li>${esc(c)}</li>`).join("")}</ol></details>`;
  }
  function qlabPreview(b, n) {
    if (b.type === "moderation") return "nichts";
    if (b.type === "film" || b.type === "sieger") return `${n} ${titleOf(b)}`;
    if (b.type === "leinwand") return `${n}.1 Bildschirmschoner → ${n}.2 Standbild`;
    if (b.type === "pause") return b.thenCanvas !== false ? `${n}.1 Pausenfilm → ${n}.2 Bildschirmschoner → ${n}.3 Standbild` : `${n}.1 Pausenfilm`;
    const parts = [], q = checks[b.id + ":n"] || "n", mt = b.mediaType || "none";
    if (b.explain) parts.push(`${n}.0 Erklärfilm`);
    if (mt !== "video") parts.push(`${n}.L Leinwand`);
    if (mt === "audio" || mt === "video") parts.push(`${n}.1 – ${n}.${q} Clips`);
    if (mt === "video" && b.solveDir) parts.push(`${n}.1.1 … Auflösungen`);
    return `Gruppe ${n}: ` + (parts.join(" · ") || "keine Cues");
  }

  // Standardpfade (Bildschirmschoner, Standbild, Pausenfilm) – gelten für den ganzen Regieplan
  function renderDefaults() {
    const box = $("plan-defaults"); if (!box || box.contains(document.activeElement)) return;
    box.innerHTML = Object.keys(BUILTIN).map((k) => `<div class="pb-row def-row"><span class="pb-lbl">${DEFAULT_LABEL[k]}</span>
      <input class="pb-path" data-dk="${k}" value="${esc(defaults[k] || "")}" placeholder="${esc(fileName(BUILTIN[k]))}" title="${esc(defaults[k] || BUILTIN[k])}" spellcheck="false">
      <button type="button" class="ic" data-dbrowse="${k}" title="Durchsuchen" ${isMac() ? "" : "disabled"}>…</button></div>`).join("");
  }
  const defBox = $("plan-defaults");
  defBox.addEventListener("change", (e) => { const k = e.target.dataset.dk; if (!k) return; const v = relPath(e.target.value); update(ref(db, P()), { [`defaults/${k}`]: v || null }); });
  defBox.addEventListener("click", (e) => {
    const k = e.target.closest("[data-dbrowse]")?.dataset.dbrowse; if (!k) return;
    browse(eff(k), k === "saverStill" ? FILTERS.image : FILTERS.media, DEFAULT_LABEL[k] + " wählen", (path) => update(ref(db, P()), { [`defaults/${k}`]: path }));
  });

  function renderEditor(force = false) {
    if (!list) return;
    if (!force && list.contains(document.activeElement)) { pendingEditorRender = true; return; }
    pendingEditorRender = false;
    $("plan-empty").classList.toggle("hidden", blocks.length > 0);
    $("plan-mac").classList.toggle("hidden", isMac());
    let roundNo = 0;
    list.innerHTML = blocks.map((b, i) => {
      const k = kindOf(b), s = b.s || {}, ck = checks[b.id];
      if (b.type === "runde") roundNo++;
      const opts = Object.entries(KINDS).map(([t, x]) => `<option value="${t}" ${t === b.type ? "selected" : ""}>${x.icon} ${x.label}</option>`).join("");
      const head = `<div class="pb-head">
          <span class="pb-num">${i + 1}</span>
          <select data-k="type" class="pb-type">${opts}</select>
          <input data-k="title" class="pb-title" maxlength="80" value="${esc(b.title)}" placeholder="${esc(b.type === "runde" ? (b.file ? titleFromFile(b.file) : "Titel der Runde") : k.label)}">
          <label class="check pb-res" title="Reserve-Blöcke überspringt WEITER – Du kannst sie in der Ablaufleiste antippen"><input type="checkbox" data-k="reserve" ${b.reserve ? "checked" : ""}> Reserve</label>
          <span class="pb-tools"><button type="button" class="ic" data-act="up" title="nach oben" ${i ? "" : "disabled"}>↑</button><button type="button" class="ic" data-act="down" title="nach unten" ${i < blocks.length - 1 ? "" : "disabled"}>↓</button><button type="button" class="ic del" data-act="del" title="Block löschen">✕</button></span>
        </div>`;
      const n = i + 1;
      let body = "";
      const ck2 = ck ? `<div class="pb-check ${ck.pending ? "" : ck.ok ? "ok" : "bad"}">${ck.pending ? "Prüfe …" : (ck.ok ? "✓ " : "✗ ") + esc(ck.text)}</div>` : "";
      if (b.type === "runde") {
        const mt = b.mediaType || "none";
        body = pathRow(b, "file", "Runde", "00 Fragensammlung/…/Runde.sqq", "round", "Rundendatei wählen")
          + pathRow(b, "image", "Titelbild", "optional – sonst automatische Titelkarte", "image", "Titelbild wählen")
          + pathRow(b, "explain", "Erklärfilm", "Erklärfilm mit Lissi (läuft immer zuerst)", "video", "Erklärfilm wählen")
          + `<div class="pb-row"><span class="pb-lbl">Medien</span><select data-k="mediaType">
               <option value="none" ${mt === "none" ? "selected" : ""}>keine – Leinwand zeigt Bildschirmschoner</option>
               <option value="audio" ${mt === "audio" ? "selected" : ""}>Ton – je Frage ein Audio-Clip, Leinwand zeigt Bildschirmschoner</option>
               <option value="video" ${mt === "video" ? "selected" : ""}>Film – je Frage ein Video-Clip</option></select></div>`
          + (mt === "audio" || mt === "video" ? pathRow(b, "clipsDir", "Clips", "Ordner – Dateien werden nach Namen sortiert den Fragen zugeordnet", mt, "Ordner mit den Clips wählen", "dir") : "")
          + (mt === "video" ? pathRow(b, "solveDir", "Auflösung", "optional: Ordner mit Auflösungen (Dalli Klick, Muhviestar)", "video", "Ordner mit den Auflösungen wählen", "dir") : "")
          + `<div class="pb-row"><span class="pb-lbl"></span><button type="button" class="btn secondary small" data-act="check">Prüfen</button></div>`
          + ck2 + clipList(b)
          + `<div class="settings pb-set">
            <label>Zeit <input type="number" data-k="s.duration" min="5" max="120" value="${esc(s.duration ?? 20)}"> s</label>
            <label>Punkte <input type="number" data-k="s.points" min="0" max="100" value="${esc(s.points ?? "")}" placeholder="auto"></label>
            <label>Speed <input type="number" data-k="s.speed" min="0" max="100" value="${esc(s.speed ?? "")}" placeholder="auto"></label>
            <label title="nur Buzzin">Sperre <select data-k="s.lockWho"><option value="player" ${s.lockWho !== "team" ? "selected" : ""}>Spieler</option><option value="team" ${s.lockWho === "team" ? "selected" : ""}>ganzes Team</option></select></label>
            <label title="nur Buzzin">für <select data-k="s.lockLen"><option value="2" ${s.lockLen !== 1 ? "selected" : ""}>diese + nächste</option><option value="1" ${s.lockLen === 1 ? "selected" : ""}>nur diese</option></select></label>
            <label class="check" style="margin:0" title="nur Buzzin"><input type="checkbox" data-k="s.sendq" ${s.sendq !== false ? "checked" : ""}> Frage aufs Handy</label>
          </div>
          <div class="small pb-hint">Grundeinstellung – am Abend je Frage änderbar</div>`;
      }
      if (b.type === "film") body = pathRow(b, "media", "Datei", "Film, Audio oder Bild", "media", "Film wählen") + chk(b, ck2);
      if (b.type === "sieger") body = pathRow(b, "media", "Datei", "Siegerfilm", "media", "Siegerfilm wählen") + chk(b, ck2);
      if (b.type === "leinwand") body = pathRow(b, "film", "Film", "Standard: " + fileName(eff("saverFilm")), "video", "Bildschirmschoner-Film wählen")
        + pathRow(b, "still", "Standbild", "Standard: " + fileName(eff("saverStill")), "image", "Standbild wählen") + chk(b, ck2);
      if (b.type === "pause") body = pathRow(b, "media", "Pausenfilm", "Standard: " + fileName(eff("pauseFilm")), "media", "Pausenfilm wählen")
        + `<div class="pb-row"><span class="pb-lbl"></span><label class="check" style="margin:0"><input type="checkbox" data-k="thenCanvas" ${b.thenCanvas !== false ? "checked" : ""}> danach Leinwand (Bildschirmschoner → Standbild)</label></div>` + chk(b, ck2);
      body += `<div class="small pb-hint pb-qlab">QLab: ${esc(qlabPreview(b, n))}</div>`;
      body += `<textarea data-k="notes" class="pb-notes" maxlength="600" placeholder="Stichworte für misterQ (erscheinen im Pult)">${esc(b.notes)}</textarea>`;
      return `<div class="pblock ${b.reserve ? "reserve" : ""} ${ck && !ck.pending && !ck.ok ? "bad" : ""}" data-i="${i}"><div class="pb-kind">${k.icon}</div><div class="pb-main">${head}${body}</div></div>`;
    }).join("");
  }

  // ---------- Dateiauswahl über die Mac-App ----------
  let modal = null;
  function browse(start, filter, title, pick, mode = "file") {
    if (!isMac()) return ctx.err("Dateien durchsuchen geht nur in der Mac-App „SQUIZZZzZ Pult“. Pfad sonst von Hand eintragen.");
    if (!modal) {
      modal = document.createElement("div"); modal.className = "modal hidden";
      modal.innerHTML = `<div class="panel modal-box"><div class="modal-head"><h2></h2><button type="button" class="ic" data-x title="Schließen">✕</button></div>
        <div class="small crumbs"></div><div class="row" style="margin-top:8px"><button type="button" class="btn secondary small" data-up>↑ eine Ebene hoch</button><button type="button" class="btn small hidden" data-here>Diesen Ordner nehmen</button></div>
        <ul class="files"></ul></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-x]")) modal.classList.add("hidden"); });
    }
    let dir = (mode === "dir" && start && !/\.[a-z0-9]{2,4}$/i.test(start) ? start : (start && start.includes("/") ? start.split("/").slice(0, -1).join("/") : "")) || store.get("sqz-browse-dir") || "00 Fragensammlung";
    modal.querySelector("[data-here]").classList.toggle("hidden", mode !== "dir");
    modal.querySelector("[data-here]").onclick = () => { store.set("sqz-browse-dir", dir); modal.classList.add("hidden"); pick(dir); };
    modal.querySelector("h2").textContent = title;
    const ul = modal.querySelector(".files");
    async function show() {
      modal.querySelector(".crumbs").textContent = "SQUIZZZzZ / " + dir;
      ul.innerHTML = "<li>Lade …</li>";
      try {
        const items = (await listDir(dir)).filter((f) => f.dir || filter.test(f.name));
        ul.innerHTML = items.map((f) => `<li data-name="${esc(f.name)}" data-dir="${f.dir ? 1 : 0}" class="${f.dir ? "" : mode === "dir" ? "info" : "pick"}">${f.dir ? "📁" : "▸"} ${esc(f.name)}</li>`).join("") || "<li class='small'>(hier nichts Passendes)</li>";
      } catch (e) { ul.innerHTML = `<li class="bad">${esc(e.message || e)}</li>`; if (dir) { dir = ""; } }
    }
    ul.onclick = (e) => {
      const li = e.target.closest("li[data-name]"); if (!li) return;
      const path = dir ? dir + "/" + li.dataset.name : li.dataset.name;
      if (li.dataset.dir === "1") { dir = path; show(); return; }
      if (mode === "dir") return;
      store.set("sqz-browse-dir", dir); modal.classList.add("hidden"); pick(path);
    };
    modal.querySelector("[data-up]").onclick = () => { dir = dir.split("/").slice(0, -1).join("/"); show(); };
    modal.classList.remove("hidden"); show();
  }

  // ---------- Am Abend: Ablauf ----------
  const nextIndex = (from) => { for (let i = from + 1; i < blocks.length; i++) if (!blocks[i].reserve) return i; return -1; };

  /** Was passiert beim nächsten WEITER? { label, fn } · { label, wait: true } · null */
  function whatNext() {
    const r = ctx.round.info();
    if (loading) return { label: "Runde wird geladen …", wait: true };
    if (r.live) {
      const st = ctx.round.step();
      if (st?.fn) return { label: st.label, fn: st.fn };
      if (st?.wait) return { label: st.wait, wait: true };
      const ni = r.blockId ? nextIndex(pos) : -1;
      return {
        label: ni >= 0 ? `Runde beenden · weiter: ${kindOf(blocks[ni]).icon} ${titleOf(blocks[ni])}` : "Runde beenden",
        fn: async () => { await ctx.round.finishRound(); if (r.blockId) await markDone(r.blockId); if (ni >= 0) await goTo(ni); },
      };
    }
    const cur = blocks[pos];
    if (cur?.type === "runde" && !done[cur.id]) return { label: `Runde laden: ${titleOf(cur)}`, fn: () => startBlock(pos) };
    const ni = nextIndex(pos);
    if (ni < 0) return blocks.length ? { label: pos >= 0 ? "Ende des Regieplans" : "Nur Reserve-Blöcke im Plan", wait: true } : null;
    return { label: `${pos < 0 ? "Start" : "Weiter"}: ${kindOf(blocks[ni]).icon} ${titleOf(blocks[ni])}`, fn: () => goTo(ni) };
  }

  const markDone = (id) => update(ref(db, P()), { [`done/${id}`]: true });

  async function goTo(i) {
    const upd = { pos: i, [`done/${blocks[i].id}`]: null };
    const cur = blocks[pos]; if (cur && cur.type !== "runde") upd[`done/${cur.id}`] = true;
    pos = i; await update(ref(db, P()), upd);
    await startBlock(i);
  }

  async function startBlock(i) {
    const b = blocks[i]; loadError = ""; if (!b) return;
    if (b.type === "runde") {
      loading = true; renderBar();
      try { await loadRoundBlock(b); }
      catch (e) { loadError = e.message || String(e); }
      finally { loading = false; renderBar(); }
    }
    // Film / Pause / Siegerverkündung lösen ab P3 ihre QLab-Cues aus.
  }

  async function loadRoundBlock(b, file = null) {
    let parsed;
    if (file) parsed = parseSpeedquizzing(await file.text(), file.name);
    else {
      if (!b.file) throw new Error(`Für „${titleOf(b)}“ ist noch keine Rundendatei eingetragen (Reiter Regieplan).`);
      if (!isMac()) throw new Error("Rundendateien per Pfad lesen geht nur in der Mac-App. Hier unten die Datei von Hand wählen.");
      parsed = parseSpeedquizzing(await readText(b.file), b.file.split("/").pop());
    }
    let img = null;
    if (b.image && isMac()) { try { img = await shrink(await readBlob(b.image), 1280, "image/jpeg", 0.85); } catch (e) { ctx.err("Titelbild nicht lesbar – Runde läuft mit automatischer Titelkarte. (" + e.message + ")"); } }
    await ctx.round.loadParsed(parsed, img, { ...(b.s || {}), title: b.title || parsed.title, blockId: b.id });
  }
  $("rb-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; const b = blocks[pos]; if (!f || !b) return;
    loading = true; loadError = ""; renderBar();
    try { await loadRoundBlock(b, f); } catch (ex) { loadError = ex.message; } finally { loading = false; renderBar(); }
  });

  async function jump(i) {
    if (i === pos && ctx.round.info().live) return;
    const r = ctx.round.info();
    if (r.live && !confirm(`Die laufende Runde „${r.title}“ wird beendet. Zu „${titleOf(blocks[i])}“ springen?`)) return;
    if (r.live) { await ctx.round.finishRound(); if (r.blockId) await markDone(r.blockId); }
    await goTo(i);
  }

  async function weiter() {
    if (busy) return;
    const n = whatNext(); if (!n?.fn) return;
    busy = true; ctx.err("");
    try { await n.fn(); } catch (e) { ctx.err(e.message || String(e)); } finally { busy = false; renderBar(); }
  }
  $("rb-next").addEventListener("click", weiter);
  // Leertaste = WEITER (auch wenn gerade ein Knopf den Fokus hat – der wird dabei losgelassen, damit er nicht mitklickt)
  document.addEventListener("keydown", (e) => {
    if (!ctx.active() || e.code !== "Space" || e.target.closest("input, textarea, select")) return;
    e.preventDefault(); if (e.target.closest("button")) e.target.blur();
    if (!e.repeat) weiter();
  });
  document.addEventListener("keyup", (e) => { if (ctx.active() && e.code === "Space" && e.target.closest("button")) e.preventDefault(); });
  $("rb-strip").addEventListener("click", (e) => { const c = e.target.closest("[data-i]"); if (c) jump(+c.dataset.i); });

  function renderBar() {
    const bar = $("runbar"); if (!bar) return;
    const has = blocks.length > 0;
    $("rb-plan").classList.toggle("hidden", !has);
    $("rb-none").classList.toggle("hidden", has);
    const r = ctx.round.info(), n = whatNext();
    // Ohne Regieplan: WEITER steuert trotzdem die geladene Runde
    $("rb-next").disabled = !n?.fn || busy;
    $("rb-next").textContent = n?.fn ? "WEITER" : n?.wait ? "WARTEN" : "WEITER";
    $("rb-next-label").textContent = n ? n.label : r.live ? "" : "Runde unten laden oder Regieplan anlegen";
    if (!has) return;
    $("rb-strip").innerHTML = blocks.map((b, i) => {
      const cls = [i === pos ? "now" : "", done[b.id] && i !== pos ? "done" : "", b.reserve ? "reserve" : ""].join(" ");
      return `<button type="button" class="chip ${cls}" data-i="${i}" title="${esc(kindOf(b).label + ": " + titleOf(b) + (b.reserve ? " (Reserve)" : ""))}">${kindOf(b).icon} ${esc(titleOf(b))}</button>`;
    }).join("");
    const cur = blocks[pos];
    $("rb-kind").textContent = cur ? `${kindOf(cur).label}${cur.reserve ? " · Reserve" : ""} · Block ${pos + 1} von ${blocks.length}` : "Noch nicht gestartet";
    $("rb-title").textContent = cur ? `${kindOf(cur).icon} ${titleOf(cur)}` : "Der Abend beginnt mit WEITER";
    $("rb-notes").textContent = cur?.notes || "";
    $("rb-notes").classList.toggle("hidden", !cur?.notes);
    $("rb-error").textContent = loadError; $("rb-error").classList.toggle("hidden", !loadError);
    $("rb-fallback").classList.toggle("hidden", !(cur?.type === "runde" && !r.live && !done[cur.id] && (loadError || !isMac())));
    const active = $("rb-strip").querySelector(".chip.now");
    if (active && active.scrollIntoView && bar.dataset.pos !== String(pos)) { active.scrollIntoView({ block: "nearest", inline: "center" }); bar.dataset.pos = String(pos); }
  }

  return { attach, detach, renderBar, renderEditor, roundFinished: (id) => id && markDone(id) };
}
