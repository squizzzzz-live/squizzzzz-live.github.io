// QLab aus dem Regieplan befüllen. Läuft nur in der Mac-App „SQUIZZZzZ Pult“ (OSC über die Brücke).
// Nummern: Gruppe = Blocknummer n · n.0 Erklärfilm · n.L1/n.L2 Leinwand (Film → Standbild) · n.1 … Clips · n.x.1 Auflösung
import { mac, listDir } from "./mac.js?v=202610240008";

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
export async function fill(spec, progress = () => {}) {
  const info = await mac("info");
  const abs = (rel) => info.root + "/" + rel;
  if (await q("/showMode").catch(() => false)) throw new Error("QLab steht auf „Show“. Bitte unten links in QLab auf „Edit“ stellen und nochmal befüllen.");
  let lists = await q("/cueLists");
  const main = lists[0]; if (!main) throw new Error("QLab meldet keine Cue-Liste.");
  // 1. Alte Cues löschen
  const old = main.cues || [];
  for (let i = 0; i < old.length; i++) { progress(`Leere QLab … ${i + 1}/${old.length}`); await q(`/delete_id/${old[i].uniqueID}`); }
  lists = await q("/cueLists");
  if ((lists[0]?.cues || []).length) throw new Error("QLab hat nicht alle alten Cues gelöscht. Bitte in QLab alles markieren, löschen und nochmal befüllen.");
  // 2. Neu anlegen
  const total = countCues(spec); let done = 0;
  async function make(c, parentId, index) {
    const id = await q("/new", [c.type]);
    if (!id) throw new Error("QLab hat beim Anlegen keine Cue-ID geliefert.");
    if (c.file) await q(`/cue_id/${id}/fileTarget`, [abs(c.file)]);
    await q(`/cue_id/${id}/number`, [c.number]);
    await q(`/cue_id/${id}/name`, [c.name]);
    if (c.cont) await q(`/cue_id/${id}/continueMode`, [c.cont]);
    await q(`/move/${id}`, [index, parentId]);
    done++; progress(`Lege Cues an … ${done}/${total}`);
    if (c.children) for (let k = 0; k < c.children.length; k++) await make(c.children[k], id, k);
    return id;
  }
  for (let i = 0; i < spec.length; i++) await make(spec[i], main.uniqueID, i);
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
  return { total, broken, contLost };
}
