// Host: Runde laden, Fragen steuern, auflösen, Punkte führen (Keypad).
import { db } from "./fb.js?v=202610232154";
import { parseSpeedquizzing, toNumber } from "./sqq.js?v=202610232154";
import { scoreQuestion } from "./scoring.js?v=202610232154";
import { playBuzzer } from "./buzzer.js?v=202610232154";
import { shrink } from "./images.js?v=202610232154";
import { ref, get, set, update, remove, onValue, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);
const TYPE_LABEL = { multi: "Multiple Choice", letters: "Anfangsbuchstabe", numbers: "Zahl", sequence: "Reihenfolge" };

export function initRound(ctx) {
  // ctx: { game(), roster(), claims(), err(msg), onResults(), active() }
  let round = null, idx = 0, pub = {}, answers = {}, results = {}, unsub = [], closeTimer = 0, tick = 0, shownIdx = -1;
  let pickedRound = null, pickedTitle = null;
  const G = () => `games/${ctx.game()}`;

  function attach() {
    detach();
    unsub.push(onValue(ref(db, `${G()}/private/round`), (s) => { round = s.val(); idx = round?.idx ?? 0; render(); }));
    unsub.push(onValue(ref(db, `${G()}/public`), (s) => { pub = s.val() || {}; subscribeAnswers(); subscribeBuzzes(); announce(); render(); }));
    unsub.push(onValue(ref(db, `${G()}/private/results`), (s) => { results = s.val() || {}; ctx.onResults(); render(); }));
  }
  let ansUnsub = null, ansQid = null;
  function subscribeAnswers() {
    if (pub.questionId === ansQid) return;
    ansUnsub && ansUnsub(); ansQid = pub.questionId || null; answers = {};
    if (ansQid) ansUnsub = onValue(ref(db, `${G()}/answers/${ansQid}`), (s) => { answers = s.val() || {}; render(); });
  }
  let buzzUnsub = null, buzzKey = null, buzzes = {};
  function subscribeBuzzes() {
    if (pub.buzzId === buzzKey) return;
    buzzUnsub && buzzUnsub(); buzzKey = pub.buzzId || null; buzzes = {};
    if (buzzKey) buzzUnsub = onValue(ref(db, `${G()}/buzzes/${buzzKey}`), (s) => { buzzes = s.val() || {}; pickWinner(); writeBuzzList(); render(); });
  }
  async function pickWinner() {
    if (pub.state !== "buzz" || !Object.keys(buzzes).length) return;
    const [uid, ts] = Object.entries(buzzes).sort((a, b) => a[1] - b[1])[0];
    const pid = Object.keys(ctx.claims()).find((p) => ctx.claims()[p] === uid);
    const name = ctx.roster()[pid]?.name || "?";
    await update(ref(db, `${G()}/public`), { state: "buzzed", buzz: { uid, pid: pid || null, name, ts } });
  }
  // Alle Buzz-Zeiten (ab Freigabe) für Host und Handys – auch die, die zu langsam waren
  let lastListKey = "";
  async function writeBuzzList() {
    if (!["buzz", "buzzed", "reveal"].includes(pub.state) || !pub.buzzOpenedAt) return;
    const claims = ctx.claims(), roster = ctx.roster();
    const list = Object.entries(buzzes).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([u, t]) => {
      const pid = Object.keys(claims).find((p) => claims[p] === u);
      return { name: roster[pid]?.name || "?", ms: Math.max(0, t - pub.buzzOpenedAt) };
    });
    const key = JSON.stringify(list); if (key === lastListKey) return; lastListKey = key;
    await set(ref(db, `${G()}/public/buzzList`), list);
  }
  function detach() { buzzUnsub && buzzUnsub(); buzzUnsub = null; buzzKey = null; unsub.forEach((u) => u()); unsub = []; ansUnsub && ansUnsub(); ansUnsub = null; ansQid = null; clearTimeout(closeTimer); clearInterval(tick); round = null; }

  // ---------- Runde laden ----------
  $("round-file").addEventListener("change", (e) => {
    pickedRound = e.target.files[0] || null;
    $("round-file-name").textContent = pickedRound ? pickedRound.name : "keine Datei";
    $("round-load").disabled = !pickedRound;
  });
  $("title-file").addEventListener("change", (e) => {
    pickedTitle = e.target.files[0] || null;
    $("title-file-name").textContent = pickedTitle ? pickedTitle.name : "kein Bild – automatische Titelkarte";
  });
  $("round-load").addEventListener("click", async () => {
    if (!pickedRound) return;
    const btn = $("round-load"); btn.disabled = true; btn.textContent = "Wird geladen …"; ctx.err("");
    try {
      const parsed = parseSpeedquizzing(await pickedRound.text(), pickedRound.name);
      if (parsed.mode === "nearest") throw new Error(`„${pickedRound.name}“ ist eine Nearest-Wins-Runde – die kommt als Nächstes. Bitte eine Keypad- (.sqq) oder Buzzin-Runde (.sqb) wählen.`);
      const unknown = parsed.questions.filter((q) => q.type === "unknown").length;
      if (unknown) throw new Error(`${unknown} Frage(n) haben einen unbekannten Typ – Runde nicht geladen.`);
      const titleImage = pickedTitle ? await shrink(pickedTitle, 1280, "image/jpeg", 0.85) : null;
      const key = "r" + Date.now();
      await set(ref(db, `${G()}/private/round`), { ...parsed, key, idx: 0, duration: 20, speed: parsed.bonus[0] || 0, loadedAt: Date.now() });
      await update(ref(db, `${G()}/public`), {
        state: "ready", roundTitle: parsed.title, roundImage: titleImage, qIndex: 0, qCount: parsed.questions.length,
        questionId: null, q: null, reveal: null, openedAt: null,
      });
      pickedRound = pickedTitle = null; $("round-file").value = ""; $("title-file").value = "";
      $("round-file-name").textContent = "keine Datei"; $("title-file-name").textContent = "kein Bild – automatische Titelkarte";
    } catch (ex) { ctx.err(ex.message); }
    finally { btn.textContent = "Runde laden"; btn.disabled = !pickedRound; }
  });

  // ---------- Steuerung ----------
  const current = () => round?.questions?.[idx];
  const qid = () => `${round.key}_${current().id}`;
  const ptsOf = (q) => (q.points ?? round.points ?? 4);
  const speedOf = (q) => (q.speed ?? round.speed ?? 0);
  function shuffle(n) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function openQuestion() {
    const q = current(); if (!q) return;
    let options = q.options || [], key = q.key;
    if (q.type === "sequence") {
      let perm; do { perm = shuffle(options.length); } while (options.length > 1 && perm.every((v, i) => v === i));
      key = [...options.keys()].map((orig) => perm.indexOf(orig)).join(",");
      options = perm.map((p) => options[p]);
    }
    const duration = Math.max(5, Math.min(120, parseInt($("duration").value, 10) || 20));
    await set(ref(db, `${G()}/private/current`), { qid: qid(), key, type: q.type });
    await update(ref(db, `${G()}/public`), {
      state: "open", questionId: qid(), qIndex: idx, qCount: round.questions.length, duration,
      openedAt: serverTimestamp(), reveal: null,
      q: { type: q.type, text: q.text, options: q.type === "multi" || q.type === "sequence" ? options : null, picture: q.picture || null },
    });
    clearTimeout(closeTimer);
    const myQid = qid();
    closeTimer = setTimeout(() => { if (pub.state === "open" && pub.questionId === myQid) closeAnswers(); }, (duration + 1) * 1000);
  }
  async function closeAnswers() { clearTimeout(closeTimer); await update(ref(db, `${G()}/public`), { state: "closed" }); }

  async function revealAnswer() {
    clearTimeout(closeTimer);
    const q = current();
    const cur = (await get(ref(db, `${G()}/private/current`))).val() || { key: q.key, type: q.type };
    if (cur.key === null || cur.key === undefined || cur.key === "") cur.key = q.key;
    if (cur.key === null || cur.key === undefined || cur.key === "") { ctx.err("Bitte zuerst die Lösung eintragen (Feld „Lösung“), dann auflösen."); $("q-key").focus(); return; }
    ctx.err("");
    const ans = (await get(ref(db, `${G()}/answers/${pub.questionId}`))).val() || {};
    const pidByUid = {}; Object.entries(ctx.claims()).forEach(([pid, uid]) => (pidByUid[uid] = pid));
    const sp = speedOf(q);
    const { perPlayer, fastest } = scoreQuestion({ type: cur.type, key: cur.key }, ans, pidByUid, ptsOf(q), sp ? [sp] : []);
    await set(ref(db, `${G()}/private/results/${round.key}/${q.id}`), { type: q.type, perPlayer, at: Date.now() });
    const roster = ctx.roster();
    await update(ref(db, `${G()}/public`), {
      state: "reveal",
      reveal: { key: cur.key, solution: q.solution, fastest: fastest ? { name: roster[fastest.pid]?.name || "?", ms: fastest.ms } : null },
    });
  }

  // ---------- Buzzin ----------
  let lastAnnounced = null;
  function announce() {                                   // Buzzername über den Mac abspielen, sobald jemand dran ist
    if (pub.state !== "buzzed" || !pub.buzz) return;
    const key = pub.buzzId + pub.buzz.uid; if (key === lastAnnounced) return; lastAnnounced = key;
    const p = ctx.roster()[pub.buzz.pid] || { name: pub.buzz.name };
    playBuzzer(ctx.buzzerFor ? ctx.buzzerFor(p) : null, p.name);
  }
  async function openBuzz(attempt = 0) {
    const q = current(); if (!q) return;
    const sendq = $("b-sendq").checked;
    await set(ref(db, `${G()}/private/current`), { qid: qid(), type: "buzz", attempt });
    await update(ref(db, `${G()}/public`), {
      state: "buzz", questionId: qid(), buzzId: `${qid()}_${attempt}`, buzz: null, buzzList: null, buzzOpenedAt: serverTimestamp(), reveal: null, qIndex: idx, qCount: round.questions.length,
      q: { type: "buzz", text: sendq ? q.text : null, picture: sendq ? (q.picture || null) : null },
    });
  }
  async function judge(correct) {
    if (pub.state !== "buzzed" || !pub.buzz) return;
    const q = current(), b = pub.buzz, base = `${G()}/private/results/${round.key}/${q.id}/perPlayer/${b.pid}`;
    if (correct) {
      await set(ref(db, base), { correct: true, points: ptsOf(q), bonus: 0 });
      await update(ref(db, `${G()}/public`), { state: "reveal", reveal: { solution: q.solution, winner: b.name, winnerUid: b.uid } });
      return;
    }
    const prev = (await get(ref(db, base))).val();
    if (!prev?.correct) await set(ref(db, base), { correct: false, points: 0, bonus: 0 });
    // Sperre: Spieler oder ganzes Team, für diese (und ggf. nächste) Frage
    const until = idx + (parseInt($("lock-len").value, 10) || 2) - 1, locks = {};
    const roster = ctx.roster(), claims = ctx.claims();
    const team = roster[b.pid]?.team;
    const pids = $("lock-who").value === "team" && team ? Object.keys(roster).filter((p) => roster[p].team === team) : [b.pid];
    pids.forEach((p) => { const u = claims[p]; if (u) locks[`locks/${u}`] = { until, name: roster[p]?.name || "?", why: b.pid === p ? "falsche Antwort" : "Team hat falsch geantwortet" }; });
    await update(ref(db, `${G()}/public`), locks);
    const cur = (await get(ref(db, `${G()}/private/current`))).val() || {};
    await openBuzz((cur.attempt || 0) + 1);
  }
  async function revealBuzz() {
    const q = current();
    await update(ref(db, `${G()}/public`), { state: "reveal", buzz: null, reveal: { solution: q.solution, winner: null } });
  }
  async function clearOldLocks(nextIdx) {
    const locks = pub.locks || {}, upd = {};
    Object.entries(locks).forEach(([u, l]) => { if ((l.until ?? -1) < nextIdx) upd[`locks/${u}`] = null; });
    if (Object.keys(upd).length) await update(ref(db, `${G()}/public`), upd);
  }

  async function go(delta, absolute = null) {
    const n = round.questions.length; if (!n) return;
    const next = Math.max(0, Math.min(n - 1, absolute ?? idx + delta));
    await update(ref(db, `${G()}/private/round`), { idx: next });
    await clearOldLocks(next);
    clearTimeout(closeTimer);
    await update(ref(db, `${G()}/public`), { state: "ready", qIndex: next, qCount: n, questionId: null, buzzId: null, buzz: null, buzzList: null, q: null, reveal: null, openedAt: null });
  }
  async function showTitle() { await update(ref(db, `${G()}/public`), { state: "ready", questionId: null, buzzId: null, buzz: null, q: null, reveal: null, openedAt: null }); }

  async function unloadRound() {
    const b = $("round-unload");
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Wirklich entladen? Nochmal klicken"; setTimeout(() => { b.dataset.confirm = ""; b.textContent = "Runde beenden & entladen"; }, 4000); return; }
    b.dataset.confirm = ""; b.textContent = "Runde beenden & entladen";
    clearTimeout(closeTimer);
    await remove(ref(db, `${G()}/private/round`));
    await remove(ref(db, `${G()}/private/current`));
    await update(ref(db, `${G()}/public`), { state: "lobby", roundTitle: null, roundImage: null, qIndex: null, qCount: null, questionId: null, buzzId: null, buzz: null, locks: null, q: null, reveal: null, openedAt: null });
  }

  // ---------- Spontane Fragen (on the fly) ----------
  function normKey(type, raw) {
    const v = String(raw || "").trim(); if (!v) return { key: null, solution: "" };
    if (type === "multi" || type === "letters") { const L = v.toUpperCase().charAt(0); return { key: L, solution: v.length > 1 ? `${v} (${L})` : L }; }
    if (type === "numbers") { const n = toNumber(v); return { key: n, solution: v }; }
    return { key: null, solution: v };
  }
  async function startSpontanRound() {
    const key = "r" + Date.now();
    await set(ref(db, `${G()}/private/round`), { title: "Spontan", mode: "mixed", points: 4, speedBonus: true, bonus: [4], speed: 4, key, idx: 0, questions: [], loadedAt: Date.now() });
    await update(ref(db, `${G()}/public`), { state: "ready", roundTitle: "Spontan", roundImage: null, qIndex: 0, qCount: 0, questionId: null, q: null, reveal: null, openedAt: null });
    $("otf-form").classList.remove("hidden");
  }
  async function addSpontan() {
    const type = $("otf-type").value, n = parseInt($("otf-n").value, 10) || 4;
    const { key, solution } = normKey(type, $("otf-sol").value);
    const q = {
      id: "o" + Date.now().toString(36), type, text: $("otf-text").value.trim(), picture: null, spontan: true,
      options: type === "multi" ? Array.from({ length: n }, () => "") : [], key, solution: solution || (type === "buzz" ? "" : ""),
      points: Math.max(0, parseInt($("otf-pts").value, 10) || 0), speed: round?.speed ?? 4,
    };
    const list = [...(round?.questions || [])], at = list.length ? idx + 1 : 0;
    list.splice(at, 0, q);
    await update(ref(db, `${G()}/private/round`), { questions: list, idx: at });
    round = { ...round, questions: list, idx: at }; idx = at;
    $("otf-text").value = ""; $("otf-sol").value = ""; $("otf-form").classList.add("hidden");
    if (type === "buzz") await openBuzz(0); else await openQuestion();
  }
  async function saveKey() {
    const q = current(); if (!q) return;
    const { key, solution } = normKey(q.type, $("q-key").value);
    await update(ref(db, `${G()}/private/round/questions/${idx}`), { key, solution });
    if (pub.questionId === qid()) await update(ref(db, `${G()}/private/current`), { key });
    $("q-key").blur();
  }
  $("otf-start").addEventListener("click", startSpontanRound);
  $("otf-toggle").addEventListener("click", () => $("otf-form").classList.toggle("hidden"));
  $("otf-cancel").addEventListener("click", () => $("otf-form").classList.add("hidden"));
  $("otf-go").addEventListener("click", addSpontan);
  $("otf-type").addEventListener("change", () => $("otf-n-wrap").classList.toggle("hidden", $("otf-type").value !== "multi"));
  $("q-key").addEventListener("change", saveKey);
  $("q-jump").addEventListener("change", (e) => go(0, parseInt(e.target.value, 10)));

  function savePoints() {
    const q = current(); if (!q) return;
    const p = Math.max(0, parseInt($("q-pts").value, 10) || 0), s = Math.max(0, parseInt($("q-speed").value, 10) || 0);
    update(ref(db, `${G()}/private/round/questions/${idx}`), { points: p, speed: s });
  }
  $("q-pts").addEventListener("change", (e) => { savePoints(); e.target.blur(); });
  $("q-speed").addEventListener("change", (e) => { savePoints(); e.target.blur(); });
  $("duration").addEventListener("change", (e) => e.target.blur());
  $("q-open").addEventListener("click", openQuestion);
  $("q-close").addEventListener("click", closeAnswers);
  $("q-reveal").addEventListener("click", revealAnswer);
  $("q-next").addEventListener("click", () => go(1));
  $("q-prev").addEventListener("click", () => go(-1));
  $("q-title").addEventListener("click", showTitle);
  $("round-unload").addEventListener("click", unloadRound);
  $("b-open").addEventListener("click", () => openBuzz(0));
  $("b-right").addEventListener("click", () => judge(true));
  $("b-wrong").addEventListener("click", () => judge(false));
  $("b-reveal").addEventListener("click", revealBuzz);
  document.addEventListener("keydown", (e) => {
    if (!round || !ctx.active() || e.target.closest("input, textarea, select")) return;
    if (e.code === "Space") { e.preventDefault(); primaryAction()?.(); }
    if (current()?.type === "buzz" && pub.state === "buzzed") { if (e.key === "r" || e.key === "R") judge(true); if (e.key === "f" || e.key === "F") judge(false); }
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  });
  function primaryAction() {
    if (current()?.type === "buzz") {
      if (pub.state === "ready") return () => openBuzz(0);
      if (pub.state === "reveal") return idx < round.questions.length - 1 ? () => go(1) : null;
      return null;
    }
    if (pub.state === "ready") return openQuestion;
    if (pub.state === "open") return closeAnswers;
    if (pub.state === "closed") return revealAnswer;
    if (pub.state === "reveal") return idx < round.questions.length - 1 ? () => go(1) : null;
    return null;
  }

  // ---------- Anzeige ----------
  function fmtAnswer(type, value, options) {
    if (value === undefined || value === null) return "–";
    if (type === "sequence" && options) return String(value).split(",").map((i) => options[+i] ?? "?").join(" → ");
    if (type === "multi" && options) { const i = String(value).charCodeAt(0) - 65; return options[i] ? `${value} · ${options[i]}` : String(value); }
    return String(value);
  }

  function totals() {
    const t = {};
    Object.values(results).forEach((r) => Object.values(r).forEach((q) =>
      Object.entries(q.perPlayer || {}).forEach(([pid, p]) => (t[pid] = (t[pid] || 0) + (p.points || 0) + (p.bonus || 0)))));
    return t;
  }

  function render() {
    const has = !!round;
    $("round-empty").classList.toggle("hidden", has);
    $("round-live").classList.toggle("hidden", !has);
    if (!has) return;
    const q = current();
    $("qbox").classList.toggle("hidden", !q); document.querySelector("#round-live .controls").classList.toggle("hidden", !q);
    document.querySelector("#round-live .settings").classList.toggle("hidden", !q);
    const jump = $("q-jump"), qs = round.questions || [];
    const sig = qs.map((x) => x.id).join() + "|" + idx;
    if (jump.dataset.sig !== sig) {
      jump.innerHTML = qs.map((x, i) => `<option value="${i}"></option>`).join("") || `<option>– noch keine Frage –</option>`;
      qs.forEach((x, i) => (jump.options[i].textContent = `${i + 1}. ${x.type === "buzz" ? "🔔 " : ""}${(x.text || (x.spontan ? "Spontane Frage" : "Frage")).slice(0, 70)}`));
      jump.value = String(idx); jump.dataset.sig = sig;
    }
    if (!q) { $("r-title").textContent = round.title; $("r-pos").textContent = "Noch keine Frage – oben „+ Spontane Frage“"; $("round-live").classList.add("mode-keypad"); $("round-live").classList.remove("mode-buzz"); return; }
    const st = pub.state;
    $("r-title").textContent = round.title;
    $("r-pos").textContent = `Frage ${idx + 1} von ${round.questions.length} · ${TYPE_LABEL[q.type] || q.type}`;
    $("r-text").textContent = q.text;
    $("r-pic").classList.toggle("hidden", !q.picture); if (q.picture) $("r-pic").src = q.picture;
    document.querySelector(".qbox").classList.toggle("nopic", !q.picture);
    const opts = $("r-opts"); opts.innerHTML = "";
    (q.type === "multi" ? q.options : []).forEach((o, i) => {
      const li = document.createElement("li"); li.textContent = `${String.fromCharCode(65 + i)}  ${o}`;
      if (String.fromCharCode(65 + i) === q.key) li.className = "ok"; opts.appendChild(li);
    });
    const noKey = q.type !== "buzz" && (q.key === null || q.key === undefined || q.key === "");
    $("r-solution").textContent = noKey ? "Lösung fehlt noch – rechts unten eintragen" : "Lösung: " + (q.solution || "–");
    $("r-solution").classList.toggle("need-key", noKey);
    $("key-wrap").classList.toggle("hidden", !(q.spontan || noKey));
    if (document.activeElement !== $("q-key")) $("q-key").value = q.key ?? "";
    if (shownIdx !== idx || document.activeElement?.closest?.(".settings") == null) {
      if (document.activeElement !== $("q-pts")) $("q-pts").value = ptsOf(q);
      if (document.activeElement !== $("q-speed")) $("q-speed").value = speedOf(q);
      shownIdx = idx;
    }

    const isBuzz = q.type === "buzz";
    $("round-live").classList.toggle("mode-buzz", isBuzz); $("round-live").classList.toggle("mode-keypad", !isBuzz);
    if (isBuzz) $("r-pos").textContent = `Frage ${idx + 1} von ${round.questions.length} · Buzzin`;
    const label = { ready: "Titelbild", open: "Antworten laufen", closed: "Geschlossen", reveal: "Aufgelöst", buzz: "Buzzer offen", buzzed: "Jemand ist dran", lobby: "–" }[st] || st;
    $("r-state").textContent = label;
    const vis = (id, on) => $(id).classList.toggle("off", !on);
    vis("q-open", st === "ready"); vis("q-close", st === "open"); vis("q-reveal", st === "open" || st === "closed");
    $("c-hint").textContent = q.type !== "buzz" && st === "reveal" ? (idx < round.questions.length - 1 ? "Leertaste = weiter" : "Letzte Frage") : "";
    $("q-next").disabled = idx >= round.questions.length - 1;
    $("q-prev").disabled = idx === 0;
    $("q-title").disabled = st === "ready";

    if (isBuzz) {
      vis("b-open", st === "ready"); vis("b-right", st === "buzzed"); vis("b-wrong", st === "buzzed");
      vis("b-reveal", st === "buzz" || st === "buzzed");
      $("c-hint").textContent = st === "reveal" ? (idx < round.questions.length - 1 ? "Leertaste = weiter" : "Letzte Frage") : st === "buzz" ? "Warte auf den ersten Buzz …" : "";
      $("q-next").disabled = idx >= round.questions.length - 1;
      $("q-prev").disabled = idx === 0;
      $("q-title").disabled = st === "ready";
      const win = $("b-win"), roster = ctx.roster();
      win.classList.toggle("live", st === "buzzed");
      const wms = pub.buzz && pub.buzzOpenedAt ? ` · ${((pub.buzz.ts - pub.buzzOpenedAt) / 1000).toFixed(2).replace(".", ",")} s` : "";
      win.innerHTML = st === "buzzed" && pub.buzz ? `<span></span><small>ist dran${wms} – R = richtig · F = falsch</small>` :
        st === "buzz" ? `Buzzer sind offen …` : st === "reveal" ? (pub.reveal?.winner ? `✓ <span></span>` : "Niemand richtig") : "–";
      if (win.querySelector("span")) win.querySelector("span").textContent = st === "buzzed" ? pub.buzz.name : pub.reveal?.winner || "";
      const ql = $("b-queue"); ql.innerHTML = "";
      const sorted = Object.entries(buzzes).sort((a, b) => a[1] - b[1]);
      const sec = (ms) => (ms / 1000).toFixed(2).replace(".", ",") + " s";
      sorted.forEach(([u, t], i) => { const pid = Object.keys(ctx.claims()).find((p) => ctx.claims()[p] === u); const li = document.createElement("li");
        li.textContent = `${roster[pid]?.name || "?"} · ${pub.buzzOpenedAt ? sec(Math.max(0, t - pub.buzzOpenedAt)) : ""}${i ? `  (+${sec(t - sorted[0][1])})` : ""}`; ql.appendChild(li); });
      $("b-count").textContent = sorted.length ? `${sorted.length} gebuzzert` : "";
      const lk = $("b-locks"); lk.innerHTML = "";
      Object.entries(pub.locks || {}).forEach(([u, l]) => {
        const li = document.createElement("li"); li.innerHTML = `<span></span><button class="btn secondary small">Aufheben</button>`;
        li.firstChild.textContent = `${l.name} · bis Frage ${l.until + 1}`;
        li.lastChild.onclick = () => set(ref(db, `${G()}/public/locks/${u}`), null);
        lk.appendChild(li);
      });
      if (!Object.keys(pub.locks || {}).length) lk.innerHTML = `<li style="background:none;border:0;padding:0" class="small">niemand</li>`;
    }
    clearInterval(tick);
    if (st === "open" && pub.openedAt) {
      const end = pub.openedAt + pub.duration * 1000;
      const upd = () => { $("r-timer").textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)) + " s"; };
      upd(); tick = setInterval(upd, 250);
    } else $("r-timer").textContent = st === "ready" ? `${$("duration").value || 20} s` : "–";

    const roster = ctx.roster(), claims = ctx.claims(), left = ctx.left ? ctx.left(pub.questionId) : {};
    const res = results[round.key]?.[q.id]?.perPlayer || null;
    const rows = Object.entries(claims).map(([pid, uid]) => ({ pid, uid, name: roster[pid]?.name || "?", a: answers[uid], r: res?.[pid] }))
      .sort((a, b) => (a.a ? a.a.ms : 1e9) - (b.a ? b.a.ms : 1e9));
    $("r-count").textContent = `${Object.keys(answers).length} von ${Object.keys(claims).length} geantwortet`;
    const tb = $("r-answers"); tb.innerHTML = "";
    rows.forEach(({ uid, name, a, r }) => {
      const tr = document.createElement("tr");
      const mark = r ? (r.correct ? "✓" : "✗") : "";
      const lv = left[uid];
      const cells = [name, a ? fmtAnswer(q.type, a.value, pub.q?.options || q.options) : "…", a ? (a.ms / 1000).toFixed(2).replace(".", ",") + " s" : "", mark, r && r.bonus ? "+" + r.bonus + " Speed" : "", lv ? `⚠ Seite verlassen (${Math.round(lv / 1000)} s)` : ""];
      cells.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i === 3) td.className = r?.correct ? "ok" : "bad"; if (i === 5) td.className = "left"; tr.appendChild(td); });
      tb.appendChild(tr);
    });
  }

  return { attach, detach, render, totals };
}
