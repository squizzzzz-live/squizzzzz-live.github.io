// Bewertung einer Antwort – identisch auf Host (Punkte) und Handy (richtig/falsch-Anzeige).
import { toNumber } from "./sqq.js?v=202610222324";

export function isCorrect(type, key, value) {
  if (value === null || value === undefined || key === null || key === undefined) return false;
  switch (type) {
    case "multi":
    case "letters": return String(value).toUpperCase().trim().charAt(0) === String(key).toUpperCase();
    case "numbers": return toNumber(value) === Number(key);
    case "sequence": return String(value).replace(/\s/g, "") === String(key);
    default: return false;
  }
}

/**
 * Punkte einer Keypad-Frage.
 * answers: { uid: { value, ms } }, pidByUid: { uid: pid }
 * Richtig = Grundpunkte; Speed-Bonus nach Reihenfolge der schnellsten Richtigen (z. B. [2, 1]).
 * Ergebnis: { perPlayer: { pid: { value, ms, correct, points, bonus } }, fastest: { pid, ms } | null }
 */
export function scoreQuestion(q, answers, pidByUid, points, bonus = []) {
  const perPlayer = {};
  const correctOnes = [];
  for (const [uid, a] of Object.entries(answers || {})) {
    const pid = pidByUid[uid]; if (!pid) continue;
    const ok = isCorrect(q.type, q.key, a.value);
    perPlayer[pid] = { value: a.value, ms: a.ms, correct: ok, points: ok ? points : 0, bonus: 0 };
    if (ok) correctOnes.push({ pid, ms: a.ms });
  }
  correctOnes.sort((a, b) => a.ms - b.ms);
  correctOnes.forEach((c, i) => { if (i < bonus.length) perPlayer[c.pid].bonus = bonus[i]; });
  return { perPlayer, fastest: correctOnes[0] || null };
}
