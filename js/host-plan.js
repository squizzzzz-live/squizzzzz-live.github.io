// Regieplan: den Abend vorbereiten (Reiter „Regieplan“) und im Pult Schritt für Schritt abarbeiten (Leiste im Reiter „Spiel“).
// Ein Block ist Film, Moderation, Runde, Pause oder Siegerverkündung. Runden zeigen auf eine Datei im Ordner SQUIZZZzZ,
// die das Pult (Mac-App) erst beim Start der Runde liest. QLab kommt in P3 dazu.
import { db } from "./fb.js?v=202610232333";
import { parseSpeedquizzing } from "./sqq.js?v=202610232333";
import { shrink } from "./images.js?v=202610232333";
import { isMac, readText, readBlob, listDir } from "./mac.js?v=202610232333";
import { ref, set, update, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const KINDS = {
  film: { label: "Film", icon: "🎬" },
  moderation: { label: "Moderation", icon: "🎤" },
  runde: { label: "Runde", icon: "🎯" },
  pause: { label: "Pause", icon: "☕" },
  sieger: { label: "Siegerverkündung", icon: "🏆" },
};
const DEFAULT_TITLE = { film: "Film", moderation: "Moderation", runde: "", pause: "Große Pause", sieger: "Siegerverkündung" };
const titleFromFile = (path) => (path.split("/").pop() || "").replace(/\.(sqq|sqb|sqn)$/i, "").replace(/^\d+[_ ]*/, "").replace(/_/g, " ").trim();
const titleOf = (b) => b ? (b.title || (b.type === "runde" && b.file ? titleFromFile(b.file) : "") || KINDS[b.type]?.label || "Block") : "";
const kindOf = (b) => KINDS[b?.type] || { label: "Block", icon: "•" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export function initPlan(ctx) {
  // ctx: { game(), err(msg), round (Rundensteuerung), active() → Reiter „Spiel“ offen?, gameTitle() }
  let blocks = [], pos = -1, done = {}, unsub = null;
  let checks = {}, loadError = "", loading = false, busy = false, pendingEditorRender = false;
  const P = () => `games/${ctx.game()}/private/plan`;

  function attach() {
    detach();
    unsub = onValue(ref(db, P()), (s) => {
      const v = s.val() || {};
      blocks = (Array.isArray(v.blocks) ? v.blocks : Object.values(v.blocks || {})).filter(Boolean);
      pos = typeof v.pos === "number" ? v.pos : -1;
      done = v.done || {};
      renderEditor(); renderBar();
    });
  }
  function detach() { unsub && unsub(); unsub = null; blocks = []; pos = -1; done = {}; checks = {}; loadError = ""; }

  const saveBlocks = () => set(ref(db, `${P()}/blocks`), blocks.map((b) => JSON.parse(JSON.stringify(b))));

  // ---------- Vorbereitung: Blöcke bearbeiten ----------
  function addBlock(type) {
    const b = { id: "b" + Date.now().toString(36), type, title: DEFAULT_TITLE[type] || "", notes: "", reserve: false };
    if (type === "runde") Object.assign(b, { file: "", image: "", s: { duration: 20, lockWho: "player", lockLen: 2, sendq: true } });
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
    if (el.dataset.k === "file") v = v.trim().replace(/^\/+/, "");
    setField(b, el.dataset.k, v);
    if (el.dataset.k === "file") delete checks[b.id];
    saveBlocks();
    if (el.dataset.k === "type") { pendingEditorRender = false; renderEditor(true); }
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
    if (act === "browse-file") browse(b.file, /\.(sqq|sqb|sqn)$/i, "Rundendatei wählen", (path) => {
      b.file = path; if (!b.title) b.title = titleFromFile(path); delete checks[b.id]; saveBlocks(); checkBlock(b);
    });
    if (act === "browse-image") browse(b.image || b.file, /\.(jpe?g|png|gif|webp)$/i, "Titelbild wählen", (path) => { b.image = path; saveBlocks(); });
    if (act === "clear-image") { b.image = ""; saveBlocks(); }
    if (act === "check") checkBlock(b);
  });
  async function fixPosAfterMove(from, to) {
    if (pos === from) await update(ref(db, P()), { pos: to });
    else if (pos === to) await update(ref(db, P()), { pos: from });
  }
  list.addEventListener("focusout", () => setTimeout(() => { if (pendingEditorRender && !list.contains(document.activeElement)) renderEditor(); }, 0));

  async function checkBlock(b) {
    if (b.type !== "runde") return;
    checks[b.id] = { pending: true }; renderEditor(true);
    try {
      if (!b.file) throw new Error("Keine Rundendatei eingetragen.");
      const parsed = parseSpeedquizzing(await readText(b.file), b.file.split("/").pop());
      ctx.round.assertPlayable(parsed, b.file.split("/").pop());
      const pics = parsed.questions.filter((q) => q.picture).length;
      let img = "";
      if (b.image) { const blob = await readBlob(b.image); img = ` · Titelbild ${Math.round(blob.size / 1000)} KB`; }
      checks[b.id] = { ok: true, text: `${parsed.questions.length} Fragen · ${parsed.mode === "buzzin" ? "Buzzin" : "Keypad"}${pics ? ` · ${pics} mit Bild` : ""}${img}` };
    } catch (e) { checks[b.id] = { ok: false, text: e.message || String(e) }; }
    renderEditor(true);
  }
  $("plan-check").addEventListener("click", async () => {
    const rounds = blocks.filter((b) => b.type === "runde");
    if (!rounds.length) { $("plan-check-msg").textContent = "Keine Runden im Plan."; return; }
    $("plan-check-msg").textContent = "Prüfe …";
    for (const b of rounds) await checkBlock(b);
    const bad = rounds.filter((b) => !checks[b.id]?.ok).length;
    $("plan-check-msg").textContent = bad ? `✗ ${bad} von ${rounds.length} Runden haben ein Problem – siehe rot markierte Blöcke.` : `✓ Alle ${rounds.length} Runden lesbar.`;
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
      let body = "";
      if (b.type === "runde") {
        body = `<div class="pb-row"><span class="pb-lbl">Datei</span><input data-k="file" class="pb-path" value="${esc(b.file)}" placeholder="00 Fragensammlung/…/Runde.sqq" spellcheck="false">
            <button type="button" class="btn secondary small" data-act="browse-file" ${isMac() ? "" : "disabled"}>Durchsuchen …</button>
            <button type="button" class="btn secondary small" data-act="check">Prüfen</button></div>
          <div class="pb-row"><span class="pb-lbl">Titelbild</span><input data-k="image" class="pb-path" value="${esc(b.image)}" placeholder="optional – sonst automatische Titelkarte" spellcheck="false">
            <button type="button" class="btn secondary small" data-act="browse-image" ${isMac() ? "" : "disabled"}>Durchsuchen …</button>${b.image ? `<button type="button" class="ic" data-act="clear-image" title="Titelbild entfernen">✕</button>` : ""}</div>
          ${ck ? `<div class="pb-check ${ck.pending ? "" : ck.ok ? "ok" : "bad"}">${ck.pending ? "Prüfe …" : (ck.ok ? "✓ " : "✗ ") + esc(ck.text)}</div>` : ""}
          <div class="settings pb-set">
            <label>Zeit <input type="number" data-k="s.duration" min="5" max="120" value="${esc(s.duration ?? 20)}"> s</label>
            <label>Punkte <input type="number" data-k="s.points" min="0" max="100" value="${esc(s.points ?? "")}" placeholder="auto"></label>
            <label>Speed <input type="number" data-k="s.speed" min="0" max="100" value="${esc(s.speed ?? "")}" placeholder="auto"></label>
            <label title="nur Buzzin">Sperre <select data-k="s.lockWho"><option value="player" ${s.lockWho !== "team" ? "selected" : ""}>Spieler</option><option value="team" ${s.lockWho === "team" ? "selected" : ""}>ganzes Team</option></select></label>
            <label title="nur Buzzin">für <select data-k="s.lockLen"><option value="2" ${s.lockLen !== 1 ? "selected" : ""}>diese + nächste</option><option value="1" ${s.lockLen === 1 ? "selected" : ""}>nur diese</option></select></label>
            <label class="check" style="margin:0" title="nur Buzzin"><input type="checkbox" data-k="s.sendq" ${s.sendq !== false ? "checked" : ""}> Frage aufs Handy</label>
          </div>
          <div class="small pb-hint">QLab-Gruppe ${roundNo} (ab P3) · Grundeinstellung – am Abend je Frage änderbar</div>`;
      }
      body += `<textarea data-k="notes" class="pb-notes" maxlength="600" placeholder="Stichworte für misterQ (erscheinen im Pult)">${esc(b.notes)}</textarea>`;
      return `<div class="pblock ${b.reserve ? "reserve" : ""} ${ck && !ck.pending && !ck.ok ? "bad" : ""}" data-i="${i}"><div class="pb-kind">${k.icon}</div><div class="pb-main">${head}${body}</div></div>`;
    }).join("");
  }

  // ---------- Dateiauswahl über die Mac-App ----------
  let modal = null;
  function browse(start, filter, title, pick) {
    if (!isMac()) return ctx.err("Dateien durchsuchen geht nur in der Mac-App „SQUIZZZzZ Pult“. Pfad sonst von Hand eintragen.");
    if (!modal) {
      modal = document.createElement("div"); modal.className = "modal hidden";
      modal.innerHTML = `<div class="panel modal-box"><div class="modal-head"><h2></h2><button type="button" class="ic" data-x title="Schließen">✕</button></div>
        <div class="small crumbs"></div><div class="row" style="margin-top:8px"><button type="button" class="btn secondary small" data-up>↑ eine Ebene hoch</button></div>
        <ul class="files"></ul></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-x]")) modal.classList.add("hidden"); });
    }
    let dir = (start && start.includes("/") ? start.split("/").slice(0, -1).join("/") : "") || store.get("sqz-browse-dir") || "00 Fragensammlung";
    modal.querySelector("h2").textContent = title;
    const ul = modal.querySelector(".files");
    async function show() {
      modal.querySelector(".crumbs").textContent = "SQUIZZZzZ / " + dir;
      ul.innerHTML = "<li>Lade …</li>";
      try {
        const items = (await listDir(dir)).filter((f) => f.dir || filter.test(f.name));
        ul.innerHTML = items.map((f) => `<li data-name="${esc(f.name)}" data-dir="${f.dir ? 1 : 0}" class="${f.dir ? "" : "pick"}">${f.dir ? "📁" : "🎯"} ${esc(f.name)}</li>`).join("") || "<li class='small'>(hier nichts Passendes)</li>";
      } catch (e) { ul.innerHTML = `<li class="bad">${esc(e.message || e)}</li>`; if (dir) { dir = ""; } }
    }
    ul.onclick = (e) => {
      const li = e.target.closest("li[data-name]"); if (!li) return;
      const path = dir ? dir + "/" + li.dataset.name : li.dataset.name;
      if (li.dataset.dir === "1") { dir = path; show(); return; }
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
