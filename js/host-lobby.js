// Host: Inhalte der Warteseite (global für alle Abende) – Bilder, Spruch-Folien, Lauftext, Einstellungen.
import { db } from "./fb.js?v=202610222257";
import { shrink } from "./images.js?v=202610222257";
import { ref, set, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const $ = (id) => document.getElementById(id);

export function initLobby(err) {
  let lobby = {};
  onValue(ref(db, "lobby"), (s) => { lobby = s.val() || {}; render(); });

  const slides = () => Object.entries(lobby.slides || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const nextOrder = () => (slides().at(-1)?.[1].order || 0) + 1;

  $("w-images").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = ""; let i = 0;
    for (const f of files) {
      $("w-upload").textContent = `Lade ${++i} von ${files.length} …`;
      try { await set(ref(db, `lobby/slides/s${Date.now().toString(36)}${i}`), { type: "image", image: await shrink(f, 1080, "image/jpeg", 0.82), order: nextOrder() + i }); }
      catch (ex) { err(`${f.name}: ${ex.message}`); }
    }
    $("w-upload").textContent = files.length ? "Fertig." : "";
  });
  $("w-text-add").addEventListener("click", async () => {
    const t = $("w-text").value.trim(); if (!t) return;
    await set(ref(db, `lobby/slides/s${Date.now().toString(36)}`), { type: "text", text: t.slice(0, 140), order: nextOrder() });
    $("w-text").value = "";
  });
  $("w-text").addEventListener("keydown", (e) => { if (e.key === "Enter") $("w-text-add").click(); });
  $("w-ticker").addEventListener("change", () => set(ref(db, "lobby/ticker"), $("w-ticker").value.trim().slice(0, 300) || null));
  $("w-interval").addEventListener("change", () => set(ref(db, "lobby/interval"), Math.max(3, Math.min(60, parseInt($("w-interval").value, 10) || 7))));
  $("w-teams").addEventListener("change", () => set(ref(db, "lobby/teams"), $("w-teams").checked));
  $("w-hello").addEventListener("change", () => set(ref(db, "lobby/hello"), $("w-hello").checked));

  async function move(id, dir) {
    const list = slides(), i = list.findIndex(([sid]) => sid === id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    await update(ref(db, "lobby/slides"), { [`${list[i][0]}/order`]: list[j][1].order || j, [`${list[j][0]}/order`]: list[i][1].order || i });
  }

  function render() {
    if (document.activeElement !== $("w-ticker")) $("w-ticker").value = lobby.ticker || "";
    if (document.activeElement !== $("w-interval")) $("w-interval").value = lobby.interval || 7;
    $("w-teams").checked = lobby.teams !== false;
    $("w-hello").checked = lobby.hello !== false;
    const box = $("w-slides"); box.innerHTML = "";
    slides().forEach(([sid, sl]) => {
      const el = document.createElement("div"); el.className = "slide";
      if (sl.type === "image") { const im = document.createElement("img"); im.src = sl.image; el.appendChild(im); }
      else { const t = document.createElement("div"); t.className = "txt"; t.textContent = sl.text; el.appendChild(t); }
      const bar = document.createElement("div"); bar.className = "bar";
      bar.innerHTML = `<span><button title="nach vorne">‹</button> <button title="nach hinten">›</button></span><button class="del" title="Folie löschen">✕</button>`;
      const [l, r] = bar.querySelectorAll("span button");
      l.onclick = () => move(sid, -1); r.onclick = () => move(sid, 1);
      bar.querySelector(".del").onclick = () => remove(ref(db, `lobby/slides/${sid}`));
      el.appendChild(bar); box.appendChild(el);
    });
    if (!slides().length) box.innerHTML = `<p class="small">Noch keine Folien. Tipp: die Bildschirmschoner der Figuren aus „05 App“ hochladen.</p>`;
  }
}
