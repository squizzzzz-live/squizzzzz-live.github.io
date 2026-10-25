// Regieplan: Liste aller Spiele aus den Steckbriefen im Vault (Regieplan v2, Schritt R1).
// Die Mac-App liefert die Notes (Befehl „sqNotes“, ab 0.1.5), games.js liest sie aus.
import { isMac, mac } from "./mac.js?v=202610252007";
import { parseGames } from "./games.js?v=202610252007";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MEDIEN = { Film: "🎬", Ton: "🎵", Bild: "🖼", keine: "" };

export function initGames({ visible }) {
  let games = [], pending = [], loaded = false, loading = false, error = "";

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

  function row(g) {
    const decks = g.decks.length ? `${g.decks.length} Deck${g.decks.length > 1 ? "s" : ""}` : "";
    const meta = [g.mechanikText, (MEDIEN[g.medien] ?? "") + (g.medien && g.medien !== "keine" ? " " + g.medien : ""), g.dauer, decks].filter((x) => x && x.trim()).map(esc).join(" · ");
    return `<li class="game" title="${esc(g.kurz)}">
      <div class="game-head"><span class="game-id">${esc(g.id.replace("SQ-", ""))}</span><span class="game-name">${esc(g.name)}</span><span class="game-ok" title="${g.geprueft ? "Steckbrief geprüft" : "Steckbrief noch nicht geprüft"}">${g.geprueft ? "✅" : "⬜"}</span></div>
      <div class="game-meta small">${meta}</div></li>`;
  }

  function render() {
    const box = $("games-list"), info = $("games-info");
    if (!box) return;
    const q = ($("games-filter")?.value || "").trim().toLowerCase();
    const list = q ? games.filter((g) => [g.id, g.name, g.mechanikText, g.medien].join(" ").toLowerCase().includes(q)) : games;
    const ok = games.filter((g) => g.geprueft).length;
    info.innerHTML = loading ? "Lade Steckbriefe …"
      : error ? `<span class="warn-note">${esc(error)}</span>`
      : loaded ? `${games.length} Spiele · ${ok} geprüft${pending.length ? ` · <span class="warn-note">${pending.length} lädt iCloud gerade, gleich ↻</span>` : ""}`
      : "";
    box.innerHTML = list.map(row).join("") || (loaded && q ? `<li class="small">Kein Spiel passt zu „${esc(q)}“.</li>` : "");
  }

  $("games-reload")?.addEventListener("click", load);
  $("games-filter")?.addEventListener("input", render);
  // Beim ersten Öffnen des Regieplans laden
  const maybeLoad = () => { if (visible() && !loaded && !loading) load(); };
  addEventListener("hashchange", maybeLoad);
  setTimeout(maybeLoad, 0);
  return { load, maybeLoad, games: () => games };
}
