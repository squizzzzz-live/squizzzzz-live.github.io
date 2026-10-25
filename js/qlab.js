// QLab aus dem Regieplan befüllen. Läuft nur in der Mac-App „SQUIZZZzZ Pult“ (OSC über die Brücke).
// Nummern: Gruppe = Blocknummer n · n.0 Erklärfilm · n.L1/n.L2 Leinwand (Film → Standbild) · n.1 … Clips · n.x.1 Auflösung
import { mac, listDir } from "./mac.js?v=202610251621";

const AUDIO = /\.(mp3|wav|aiff?|m4a|aac)$/i;
const VIDEO = /\.(mp4|mov|m4v)$/i;
const sortNames = (a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
const fileName = (p) => (p || "").split("/").pop();
const cueType = (path) => (AUDIO.test(path) ? "audio" : "video");   // Video-Cues spielen auch Standbilder
export const AUTO_FOLLOW = 2;

/** Antwort von QLab holen; Fehlerstatus wird zur Ausnahme. */
export async function q(address, args = []) {
  const r = JSON.parse(await mac("qlab", { address, args }));
  if (r.status !== "ok") throw new Error(`QLab lehnt ${address} ab (${r.status}).`);
  return r.data;
}

async function clips(dir, filter) {
  const items = await listDir(dir);
  return items.filter((f) => !f.dir && filter.test(f.name)).map((f) => dir + "/" + f.name).sort(sortNames);
}

/**
 * Baut aus dem Regieplan die Liste der QLab-Cues (ohne QLab zu berühren).
 * Ergebnis: [{ type, number, name, file?, cont?, children? }] · plus Warnungen.
 */
export async function buildSpec(blocks, eff, titleOf, countQuestions) {
  const spec = [], warn = [];
  const leaf = (number, name, file, cont = 0) => ({ type: cueType(file), number, name, file, cont });
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], n = String(i + 1), title = titleOf(b);
    if (b.type === "moderation") continue;
    if (b.type === "film" || b.type === "sieger") {
      if (!b.media) { warn.push(`Block ${n} „${title}“: keine Datei – übersprungen.`); continue; }
      spec.push(leaf(n, title, b.media));
    }
    if (b.type === "leinwand") {
      spec.push({ type: "group", number: n, name: title, children: [
        leaf(`${n}.1`, "Bildschirmschoner", b.film || eff("saverFilm"), AUTO_FOLLOW),
        leaf(`${n}.2`, "Standbild", b.still || eff("saverStill")),
      ] });
    }
    if (b.type === "pause") {
      const canvas = b.thenCanvas !== false;
      const ch = [leaf(`${n}.1`, "Pausenfilm", b.media || eff("pauseFilm"), canvas ? AUTO_FOLLOW : 0)];
      if (canvas) ch.push(leaf(`${n}.2`, "Bildschirmschoner", eff("saverFilm"), AUTO_FOLLOW), leaf(`${n}.3`, "Standbild", eff("saverStill")));
      spec.push({ type: "group", number: n, name: title, children: ch });
    }
    if (b.type === "runde") {
      const ch = [], mt = b.mediaType || "none";
      if (b.explain) ch.push(leaf(`${n}.0`, "Erklärfilm", b.explain));
      else warn.push(`Block ${n} „${title}“: kein Erklärfilm eingetragen.`);
      if (mt !== "video") ch.push(leaf(`${n}.L1`, "Leinwand: Bildschirmschoner", eff("saverFilm"), AUTO_FOLLOW), leaf(`${n}.L2`, "Leinwand: Standbild", eff("saverStill")));
      if ((mt === "audio" || mt === "video") && b.clipsDir) {
        const list = await clips(b.clipsDir, mt === "audio" ? AUDIO : VIDEO);
        const sol = mt === "video" && b.solveDir ? await clips(b.solveDir, VIDEO) : [];
        const nq = await countQuestions(b);
        if (nq && list.length !== nq) warn.push(`Block ${n} „${title}“: ${list.length} Clips für ${nq} Fragen.`);
        list.forEach((f, j) => {
          ch.push(leaf(`${n}.${j + 1}`, `Frage ${j + 1} · ${fileName(f)}`, f));
          if (sol[j]) ch.push(leaf(`${n}.${j + 1}.1`, `Auflösung ${j + 1} · ${fileName(sol[j])}`, sol[j]));
        });
      } else if (mt !== "none") warn.push(`Block ${n} „${title}“: Medien „${mt === "audio" ? "Ton" : "Film"}“, aber kein Clip-Ordner.`);
      spec.push({ type: "group", number: n, name: title, children: ch });
    }
  }
  return { spec, warn };
}

export const countCues = (spec) => spec.reduce((s, c) => s + 1 + (c.children ? c.children.length : 0), 0);

/** Workspace leeren und die Cues anlegen. progress(text) wird laufend aufgerufen. */
export async function fill(spec, progress = () => {}, opts = {}) {
  const patch = parseInt(opts.audioPatch, 10) || 0, stageID = opts.stageID || "";
  let stageFailed = false;
  const info = await mac("info");
  const abs = (rel) => info.root + "/" + rel;
  if (await q("/showMode").catch(() => false)) throw new Error("QLab steht auf „Show“. Bitte unten links in QLab auf „Edit“ stellen und nochmal befüllen.");
  let lists = await q("/cueLists");
  const main = lists[0]; if (!main) throw new Error("QLab meldet keine Cue-Liste.");
  // 1. Alte Cues erst NACH dem Anlegen löschen: In einer leeren Liste legt QLab per OSC keine neuen Cues an
  //    (neue Cues kommen hinter den ausgewählten). Alte Nummern vorher leeren, damit keine doppelten entstehen.
  const old = main.cues || [];
  const flat = []; const walk = (arr) => arr.forEach((c) => { flat.push(c.uniqueID); if (c.cues) walk(c.cues); }); walk(old);
  for (let i = 0; i < flat.length; i++) { progress(`Bereite QLab vor … ${i + 1}/${flat.length}`); await q(`/cue_id/${flat[i]}/number`, [""]); }
  if (old.length) await q(`/select_id/${old[old.length - 1].uniqueID}`).catch(() => {});
  else await q(`/select_id/${main.uniqueID}`).catch(() => {});
  // 2. Neu anlegen
  const total = countCues(spec); let done = 0;
  async function make(c, parentId, index) {
    let id;
    try { id = await q("/new", [c.type]); }
    catch (e) {
      if (!old.length && done === 0) throw new Error("In eine ganz leere QLab-Liste kann das Pult keine Cues einfügen. Bitte in QLab einmal irgendeinen Cue anlegen (egal welchen) und nochmal befüllen – den räumt das Pult dann selbst weg.");
      throw e;
    }
    if (!id) throw new Error("QLab hat beim Anlegen keine Cue-ID geliefert.");
    if (c.file) await q(`/cue_id/${id}/fileTarget`, [abs(c.file)]);
    await q(`/cue_id/${id}/number`, [c.number]);
    await q(`/cue_id/${id}/name`, [c.name]);
    if (c.cont) await q(`/cue_id/${id}/continueMode`, [c.cont]);
    if (patch && c.type !== "group") await q(`/cue_id/${id}/audioOutputPatchNumber`, [patch]);
    if (stageID && c.type === "video" && !stageFailed) await q(`/cue_id/${id}/stageID`, [stageID]).catch(() => { stageFailed = true; });
    await q(`/move/${id}`, [index, parentId]);
    done++; progress(`Lege Cues an … ${done}/${total}`);
    if (c.children) for (let k = 0; k < c.children.length; k++) await make(c.children[k], id, k);
    return id;
  }
  for (let i = 0; i < spec.length; i++) await make(spec[i], main.uniqueID, i);
  // Jetzt die alten Cues entfernen
  for (let i = 0; i < old.length; i++) { progress(`Räume alte Cues weg … ${i + 1}/${old.length}`); await q(`/delete_id/${old[i].uniqueID}`); }
  lists = await q("/cueLists");
  const left = (lists[0]?.cues || []).filter((c) => old.some((o) => o.uniqueID === c.uniqueID));
  if (left.length) throw new Error(`QLab hat ${left.length} alte Cues nicht gelöscht. Die neuen sind trotzdem angelegt – die alten (ohne Nummer) bitte in QLab von Hand löschen.`);
  // 3. Prüfen: Folgemodus angekommen? Cues spielbar?
  progress("Prüfe …");
  const broken = [], contLost = [];
  async function verify(c) {
    const isBroken = await q(`/cue/${c.number}/isBroken`).catch(() => null);
    if (isBroken) broken.push(`${c.number} ${c.name}`);
    if (c.cont) { const m = await q(`/cue/${c.number}/continueMode`).catch(() => null); if (m !== c.cont) contLost.push(c.number); }
    if (c.children) for (const k of c.children) await verify(k);
  }
  for (const c of spec) await verify(c);
  return { total, broken, contLost, stageFailed };
}

/** Alle Cues auf einen Tonausgang (Patch-Nummer in QLab) umstellen – für den Techniktest. */
export async function setAudioPatch(patch) {
  await q("/cue/*/audioOutputPatchNumber", [parseInt(patch, 10)]);
}
/** Alle Video-Cues auf eine Bildausgabe (Stage) umstellen. */
export async function setStage(stageID) {
  await q("/cue/*/stageID", [stageID]);
}

const asList = (v) => Array.isArray(v) ? v : Array.isArray(v?.stages) ? v.stages : v && typeof v === "object" ? Object.values(v) : [];
/** Ton- und Bildausgänge des Workspace mit Namen: { audio: [{ no, name, id }], video: [{ name, id }] } */
export async function listOutputs() {
  const audio = asList(await q("/settings/audio/patchList")).map((p, i) => ({ no: i + 1, name: p.name || `Patch ${i + 1}`, id: p.uniqueID }));
  let video = [];
  try { video = asList(await q("/settings/video/stages")).map((s, i) => ({ no: i + 1, name: s.name || `Stage ${i + 1}`, id: s.uniqueID })); } catch (e) { /* ältere QLab-Version */ }
  return { audio, video };
}
