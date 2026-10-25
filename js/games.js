// Spiel-Steckbriefe (Vault-Notes SQ-0xx-….md) auslesen.
// Die Mac-App liefert die Notes als Text (Befehl „sqNotes“), hier wird daraus ein Spiel-Objekt.
// Kein DOM, damit es auch in Node testbar ist.

/** Kopfdaten (YAML-Frontmatter) – nur das, was die Steckbriefe benutzen: key: wert, Listen als [..] oder „- …“. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      out[key] = value(kv[2]);
    } else if (key && /^\s*-\s+/.test(line)) {
      const v = value(line.replace(/^\s*-\s+/, ""));
      out[key] = Array.isArray(out[key]) ? [...out[key], v] : (out[key] === "" || out[key] == null ? [v] : [out[key], v]);
    }
  }
  return out;
}

function value(raw) {
  const s = raw.trim();
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(",").map((x) => unquote(x.trim())) : [];
  }
  return unquote(s);
}
const unquote = (s) => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);

/** Abschnitt „## Titel“ bis zum nächsten „## “. */
export function section(text, title) {
  const re = new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const m = re.exec(text);
  return m ? m[1] : "";
}

/** Zellen einer Markdown-Tabellenzeile; „\|“ (z. B. in [[Link\|Name]]) trennt nicht. */
export function cells(line) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Erste Markdown-Tabelle in einem Text → Zeilen als Objekte mit den Spaltennamen. */
export function table(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return [];
  const head = cells(lines[0]);
  return lines.slice(2).map((l) => {
    const c = cells(l), row = {};
    head.forEach((h, i) => { row[h || `#${i}`] = c[i] ?? ""; });
    return row;
  });
}

const plain = (s) => String(s ?? "").replace(/\*\*|\*|`/g, "").trim();
const num = (s) => { const n = parseInt(String(s).replace(/\D/g, ""), 10); return Number.isFinite(n) ? n : null; };
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

/** Eine Note → Spiel. */
export function parseGame(name, text) {
  const fm = frontmatter(text);
  const steck = {};
  for (const r of table(section(text, "Steckbrief"))) {
    const keys = Object.keys(r);
    if (keys.length >= 2) steck[plain(r[keys[0]])] = plain(r[keys[1]]);
  }
  const decks = table(section(text, "Decks")).map((r) => ({
    nr: plain(r["Nr."]),
    deck: plain(r.Deck),
    datei: plain(r.Datei),
    mechanik: plain(r.Mechanik) || null,
    fragearten: plain(r.Fragearten) || null,
    fragen: num(r.Fragen),
    clips: num(r.Clips),
    pruefen: plain(r["Prüfen"]),
  })).filter((d) => d.datei || d.deck);
  const id = String(fm.id || (/^(SQ-\d{3})/.exec(name) || [])[1] || "");
  const mech = asList(fm.mechanik);
  const arten = (/Keypad\s*\(([^)]*)\)/.exec(steck.Mechanik || "") || [])[1];
  const mechanikText = mech.length ? mech.map((m) => (m === "Keypad" && arten ? `Keypad (${arten})` : m)).join(", ") : "keine Rundendatei";
  return {
    id,
    typ: String(fm.typ || ""),
    note: name,
    name: String(fm.name || name.replace(/^SQ-\d{3}-/, "").replace(/\.md$/, "")),
    mechanik: mech,
    mechanikText,
    medien: String(fm.medien || "keine"),
    dauer: String(fm.dauer || ""),
    ordner: String(fm.ordner || ""),
    erklaerfilm: String(fm.erklaerfilm || ""),
    titelbild: String(fm.titelbild || ""),
    tasche: fm.tasche === "" || fm.tasche == null ? null : String(fm.tasche),
    app: String(fm.app || ""),
    format: String(fm.format || ""),
    geprueft: fm.geprueft === true,
    kurz: (/^>\s*(.+)$/m.exec(text) || [])[1]?.trim() || "",
    decks,
  };
}

/** Alle Notes → Spiele, sortiert nach ID. Ungültige Notes landen in „errors“. */
export function parseGames(notes) {
  const games = [], errors = [];
  for (const n of notes || []) {
    try { const g = parseGame(n.name, n.text); if (g.typ === "Spiel") games.push(g); }
    catch (e) { errors.push(`${n.name}: ${e.message}`); }
  }
  games.sort((a, b) => a.id.localeCompare(b.id, "de", { numeric: true }));
  return { games, errors };
}

/** Dauer „13–17 min“ → { min: 13, max: 17 } (für die Summe im Regieplan). */
export function dauerRange(s) {
  const m = /(\d+)\s*(?:[–-]\s*(\d+))?/.exec(String(s || ""));
  if (!m) return null;
  const min = +m[1], max = m[2] ? +m[2] : min;
  return { min, max };
}
