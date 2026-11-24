// Regieplan: Spiele aus den Steckbriefen im Vault (Regieplan v2).
// R1: Liste aller Spiele. R2: Spiel antippen → Deck wählen → Runde mit allem Vorbelegten.
// Die Mac-App liefert die Notes (Befehl „sqNotes“, ab 0.1.5), games.js liest sie aus.
import { isMac, mac, listDir } from "./mac.js?v=202610252029";
import { parseGames } from "./games.js?v=202610252029";
import { IMAGE } from "./clipmap.js?v=202610252029";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MEDIEN = { Film: "🎬", Ton: "🎵", Bild: "🖼", keine: "" };
const MEDIA_TYPE = { Film: "video", Ton: "audio" };
// macOS liefert Umlaute in Dateinamen oft zerlegt (u + ¨), die Notes zusammengesetzt (ü) – deshalb so vergleichen
const same = (a, b) => a.normalize("NFC") === b.normalize("NFC");

/** Datei in einem Ordner und seinen Unterordnern suchen (Steckbrief nennt nur den Dateinamen). */
async function findFile(root, name, depth = 3) {
  const queue = [[root, 0]];
  while (queue.length) {
    const [dir, d] = queue.shift();
    let items;
    try { items = await listDir(dir); } catch { continue; }
    const hit = items.find((f) => !f.dir && same(f.name, name));
    if (hit) return `${dir}/${hit.name}`;
    if (d < depth) for (const f of items) if (f.dir && !/^(\.|99 |Adobe )/.test(f.name)) queue.push([`${dir}/${f.name}`, d + 1]);
  }
  return null;
}

/** Erste Datei „n.T …“ (Titelbild) in einem der Ordner. */
async function findTitle(dirs) {
  for (const dir of dirs) {
    try { const hit = (await listDir(dir)).find((f) => !f.dir && /^n\.T\b/i.test(f.name) && IMAGE.test(f.name)); if (hit) return `${dir}/${hit.name}`; } catch {}
  }
  return "";
}

/** Deck-Name für den Rundentitel – weggelassen, wenn er nur der Spielname als Dateiname ist („00 KrautUndRueben“). */
const simple = (s) => s.normalize("NFC").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "");
export function deckLabel(g, d) {
  const label = String(d.deck || "").replace(/^\d+[_ ]*/, "").replace(/_/g, " ").trim();
  if (!label || g.decks.length < 2 && simple(label).includes(simple(g.name))) return "";
  return simple(label) === simple(g.name) ? `Deck ${d.nr}` : label;
}

/** Aus Spiel + Deck die Felder eines Runden-Blocks bauen. */
export async function roundFields(g, d) {
  if (!g.ordner) throw new Error(`${g.id}: Im Steckbrief fehlt der Ordner.`);
  if (!d.datei) throw new Error(`${g.id}: Deck ${d.nr} hat keine Rundendatei.`);
  const file = await findFile(g.ordner, d.datei);
  if (!file) throw new Error(`${g.id}: „${d.datei}“ nicht gefunden unter ${g.ordner}.`);
  const deckDir = file.split("/").slice(0, -1).join("/");
  const mediaType = MEDIA_TYPE[g.medien] || "none";
  const mech = d.mechanik || g.mechanik[0] || "";
  const onlyBuzzer = /nur Buzzer/i.test(g.steckbrief?.Handys || "");
  return {
    title: g.name + (deckLabel(g, d) ? ` · ${deckLabel(g, d)}` : ""),
    file,
    explain: g.erklaerfilm || "",
    image: g.titelbild || (await findTitle([g.ordner, deckDir])),
    mediaType,
    clipsDir: mediaType === "none" ? "" : deckDir,
    solveDir: "",
    game: g.id, deckNr: d.nr, deckName: d.deck, tasche: g.tasche || "", dauer: g.dauer || "", mechanik: mech,
    s: { duration: 20, lockWho: "player", lockLen: 2, sendq: /buzz/i.test(mech) ? !onlyBuzzer : true },
  };
}

export function initGames({ visible, addRound }) {
  let games = [], pending = [], loaded = false, loading = false, error = "", open = "", busy = "", note = "";

  async function load() {
    if (loading) return;
    if (!isMac()) { error = "Die Spieleliste kommt aus den Steckbriefen im Vault und geht nur in der Mac-App „SQUIZZZzZ Pult“."; render(); return; }
    loading = true; error = ""; render();
    try {
      const r = await mac("sqNotes");
      const p = parseGames(r.notes);
      games = p.games; pending = r.pending || [];
      if (p.errors.length) error = "Nicht lesbar: " + p.errors.join(" · ");
      loaded = true;
    } catch (e) {
      const m = String(e?.message || e);
      error = /Unbekannter Befehl/.test(m)
        ? "Die Mac-App ist zu alt für die Spieleliste. Bitte „SQUIZZZzZ Pult“ ab Version 0.1.5 installieren (Release „pult-latest“)."
        : m;
    } finally { loading = false; render(); }
  }

  async function add(id, nr) {
    const g = games.find((x) => x.id === id), d = g?.decks.find((x) => x.nr === nr);
    if (!g || !d || busy) return;
    busy = `${id}:${nr}`; note = ""; render();
    try {
      const b = addRound(await roundFields(g, d));
      note = `✓ „${b.title}“ steht als Runde im Regieplan und wird geprüft.`;
    } catch (e) { note = "✗ " + (e?.message || e); }
    finally { busy = ""; render(); }
  }

  function deckRow(g, d) {
    const meta = [d.fragen ? `${d.fragen} Fragen` : "", d.fragearten || d.mechanik || "", d.pruefen ? "⚠ " + d.pruefen : ""].filter(Boolean).map(esc).join(" · ");
    const id = `${g.id}:${d.nr}`;
    return `<button type="button" class="deck" data-add="${esc(id)}" ${busy ? "disabled" : ""}>
      <span class="deck-name">${busy === id ? "Lege an …" : `+ Deck ${esc(d.nr)} · ${esc(d.deck || d.datei)}`}</span><span class="small">${meta}</span></button>`;
  }

  function row(g) {
    const decks = g.decks.length ? `${g.decks.length} Deck${g.decks.length > 1 ? "s" : ""}` : "";
    const meta = [g.mechanikText, (MEDIEN[g.medien] ?? "") + (g.medien && g.medien !== "keine" ? " " + g.medien : ""), g.dauer, decks].filter((x) => x && x.trim()).map(esc).join(" · ");
    const isOpen = open === g.id;
    const body = !isOpen ? "" : g.decks.some((d) => d.datei)
      ? `<div class="decks">${g.decks.filter((d) => d.datei).map((d) => deckRow(g, d)).join("")}</div>`
      : `<div class="decks small">Keine Rundendatei – dieses Spiel kann das Pult noch nicht als Runde anlegen.</div>`;
    return `<li class="game ${isOpen ? "open" : ""}" title="${esc(g.kurz)}">
      <button type="button" class="game-btn" data-open="${esc(g.id)}">
        <div class="game-head"><span class="game-id">${esc(g.id.replace("SQ-", ""))}</span><span class="game-name">${esc(g.name)}</span><span class="game-ok" title="${g.geprueft ? "Steckbrief geprüft" : "Steckbrief noch nicht geprüft"}">${g.geprueft ? "✅" : "⬜"}</span></div>
        <div class="game-meta small">${meta}</div></button>${body}</li>`;
  }

  function render() {
    const box = $("games-list"), info = $("games-info"), noteEl = $("games-note");
    if (!box) return;
    const q = ($("games-filter")?.value || "").trim().toLowerCase();
    const list = q ? games.filter((g) => [g.id, g.name, g.mechanikText, g.medien].join(" ").toLowerCase().includes(q)) : games;
    const ok = games.filter((g) => g.geprueft).length;
    info.innerHTML = loading ? "Lade Steckbriefe …"
      : error ? `<span class="warn-note">${esc(error)}</span>`
      : loaded ? `${games.length} Spiele · ${ok} geprüft${pending.length ? ` · <span class="warn-note">${pending.length} lädt iCloud gerade, gleich ↻</span>` : ""}`
      : "";
    if (noteEl) { noteEl.textContent = note; noteEl.className = "small " + (note.startsWith("✗") ? "warn-note" : note ? "ok-note" : ""); }
    box.innerHTML = list.map(row).join("") || (loaded && q ? `<li class="small">Kein Spiel passt zu „${esc(q)}“.</li>` : "");
  }

  $("games-reload")?.addEventListener("click", load);
  $("games-filter")?.addEventListener("input", render);
  $("games-list")?.addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]"); if (a) { const i = a.dataset.add.indexOf(":"); return add(a.dataset.add.slice(0, i), a.dataset.add.slice(i + 1)); }
    const o = e.target.closest("[data-open]"); if (o) { open = open === o.dataset.open ? "" : o.dataset.open; render(); }
  });
  // Beim ersten Öffnen des Regieplans laden
  const maybeLoad = () => { if (visible() && !loaded && !loading) load(); };
  addEventListener("hashchange", maybeLoad);
  setTimeout(maybeLoad, 0);
  return { load, maybeLoad, games: () => games };
}
