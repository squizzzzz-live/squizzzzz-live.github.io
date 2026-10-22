// Liest Speedquizzing-Rundendateien (.sqq Keypad, .sqb Buzzin, .sqn Nearest Wins) direkt ein.
// Ergebnis ist das SQUIZZZzZ-Rundenmodell, das Host- und Spielerseite verwenden.
// Die Datei wird nur im Browser des Hosts gelesen – sie wird nirgends hochgeladen außer in die geschützte Datenbank.

const TYPES = { multi: "multi", letters: "letters", numbers: "numbers", sequence: "sequence" };

function text(el, tag) {
  const n = el.getElementsByTagName(tag)[0];
  return n && n.textContent != null ? n.textContent.trim() : "";
}

function pictureUrl(b64) {
  if (!b64) return null;
  const clean = b64.replace(/\s+/g, "");
  const mime = clean.startsWith("iVBOR") ? "image/png" : clean.startsWith("R0lGOD") ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${clean}`;
}

/** @param {string} xmlText  Inhalt der Datei  @param {Document Parser} parser  (Browser: new DOMParser()) */
export function parseSpeedquizzing(xmlText, fileName = "", parser = new DOMParser()) {
  const doc = parser.parseFromString(xmlText, "text/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.getElementsByTagName("round").length) {
    throw new Error("Die Datei ist keine lesbare Speedquizzing-Runde (XML fehlerhaft).");
  }
  const round = doc.getElementsByTagName("round")[0];
  const game = text(round, "game");               // "Quizsentials" (Keypad), "Buzzin", "Nearest Wins"
  const mode = /buzz/i.test(game) ? "buzzin" : /nearest/i.test(game) ? "nearest" : "keypad";
  const points = parseInt(text(round, "points_per_question"), 10) || 4;
  const speedBonus = text(round, "speed_bonus") === "true";
  const title = fileName.replace(/\.(sqq|sqb|sqn)$/i, "").replace(/^\d+[_ ]*/, "").replace(/_/g, " ").trim() || "Runde";

  const questions = [...round.getElementsByTagName("question")].map((q, i) => {
    const view = text(q, "user_view") || (mode === "nearest" ? "numbers" : mode === "buzzin" ? "buzz" : "");
    const options = [...q.getElementsByTagName("option")].map((o) => o.textContent.trim());
    const short = text(q, "short_answer"), long = text(q, "long_answer");
    const base = {
      id: "q" + String(i + 1).padStart(2, "0"),
      text: text(q, "q"),
      picture: pictureUrl(text(q, "picture")),
      sourceId: text(q, "id") || null,
    };
    if (mode === "buzzin") return { ...base, type: "buzz", options: [], key: null, solution: long || short };
    if (mode === "nearest") return { ...base, type: "nearest", options: [], key: toNumber(short), solution: short + (long ? " · " + long : "") };
    switch (view) {
      case TYPES.multi: {
        const letter = short.toUpperCase().charAt(0);
        const idx = letter.charCodeAt(0) - 65;
        return { ...base, type: "multi", options, key: letter, solution: `${letter} · ${options[idx] || long}` };
      }
      case TYPES.letters:
        return { ...base, type: "letters", options: [], key: short.toUpperCase().charAt(0), solution: `${long || short} (${short.toUpperCase().charAt(0)})` };
      case TYPES.numbers:
        return { ...base, type: "numbers", options: [], key: toNumber(short), solution: short + (long ? " · " + long : "") };
      case TYPES.sequence:
        // In Speedquizzing-Dateien stehen die Optionen in der richtigen Reihenfolge.
        return { ...base, type: "sequence", options, key: options.map((_, k) => k).join(","), solution: options.join(" → ") + (long ? `  (${long})` : "") };
      default:
        return { ...base, type: "unknown", options, key: null, solution: long || short };
    }
  });

  return { title, mode, points, speedBonus, bonus: speedBonus ? [2, 1] : [], questions, source: fileName };
}

export function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
