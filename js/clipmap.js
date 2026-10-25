// Zuordnung Frage ↔ Clip über die Nummer im Dateinamen (Entscheidung Martin, 25.10.2026):
//   „3 Kolosseum.mp4“ / „03 Kolosseum.mp4“ = Clip zu Frage 3
//   „3.1 Kolosseum.png“                     = Auflösung zu Frage 3
// Nichts wird geraten: doppelte Nummern, fehlende Clips und überzählige Nummern werden gemeldet.

export const AUDIO = /\.(mp3|wav|aiff?|m4a|aac)$/i;
export const VIDEO = /\.(mp4|mov|m4v)$/i;
export const IMAGE = /\.(jpe?g|png|gif|tiff?|heic)$/i;
const NUM = /^(\d+)(?:\.(\d+))?(?=[\s_-]|\.[A-Za-z0-9]+$)/;
const sortNames = (a, b) => a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });

/**
 * @param {string[]} names  Dateinamen im Ordner
 * @param {"audio"|"video"} kind  Art der Clips
 * @param {number} nq  Zahl der Fragen (0 = unbekannt)
 * @param {{ solvesPlain?: boolean }} opt  solvesPlain: Ordner enthält nur Auflösungen, „3 …“ = Auflösung 3
 */
export function mapByNumber(names, kind, nq = 0, opt = {}) {
  const clipRe = kind === "audio" ? AUDIO : VIDEO;
  const clips = new Map(), solves = new Map(), dup = [], loose = [];
  for (const name of [...names].sort(sortNames)) {
    if (name.startsWith(".") || /^n\./i.test(name)) continue;          // versteckt bzw. n.0 Erklärfilm, n.T Titelbild
    const m = NUM.exec(name);
    const isClip = clipRe.test(name), isSolve = VIDEO.test(name) || IMAGE.test(name);
    if (!m) { if (isClip) loose.push(name); continue; }
    const q = parseInt(m[1], 10);
    const solve = m[2] !== undefined ? m[2] === "1" && isSolve : opt.solvesPlain && isSolve;
    if (m[2] !== undefined && !solve) continue;
    if (solve) { if (solves.has(q)) dup.push(name); else solves.set(q, name); continue; }
    if (!isClip) continue;
    if (clips.has(q)) dup.push(name); else clips.set(q, name);
  }
  const n = nq || Math.max(0, ...clips.keys());
  const missing = [], extra = [];
  for (let q = 1; q <= n; q++) if (!clips.has(q)) missing.push(q);
  for (const q of clips.keys()) if (q < 1 || (nq && q > nq)) extra.push(q);
  return { clips, solves, dup, loose, missing, extra, n };
}

/** Probleme als kurze Texte für Prüfen und „QLab befüllen“. */
export function problems(r, { needClips = true } = {}) {
  const out = [];
  if (needClips && r.missing.length) out.push(`kein Clip für Frage ${list(r.missing)}`);
  if (r.extra.length) out.push(`Clip-Nummer ${list(r.extra)} hat keine Frage`);
  if (r.dup.length) out.push(`doppelte Nummer: ${r.dup.join(", ")}`);
  if (r.loose.length) out.push(`ohne Nummer: ${r.loose.slice(0, 3).join(", ")}${r.loose.length > 3 ? " …" : ""}`);
  return out;
}
const list = (a) => (a.length > 6 ? `${a.slice(0, 6).join(", ")} … (${a.length})` : a.join(", "));
