// Update-Hinweis: vergleicht den Build der geladenen Seite mit /version.json.
// Lädt nie von selbst neu – zeigt nur einen Hinweis (wichtig während eines Spiels).
const meta = document.querySelector('meta[name="sqz-build"]');
const mine = meta ? meta.content : "";
const root = new URL("../", import.meta.url);           // js/ liegt eine Ebene unter der Wurzel

export async function hardReload() {
  try {
    // HTML frisch holen und den Browser-Cache dabei überschreiben, dann neu laden
    await fetch(location.href, { cache: "reload" });
  } catch (e) { /* offline – trotzdem neu laden */ }
  location.reload();
}

let shown = false;
function banner(build) {
  if (shown) return; shown = true;
  const b = document.createElement("div");
  b.className = "update-banner";
  b.innerHTML = '<span>Neue Version der App ist da.</span><button type="button">Neu laden</button>';
  b.querySelector("button").addEventListener("click", hardReload);
  document.body.appendChild(b);
}

async function check() {
  if (!mine || shown) return;
  try {
    const r = await fetch(new URL("version.json", root), { cache: "no-store" });
    if (!r.ok) return;
    const { build } = await r.json();
    if (build && build > mine) banner(build);
  } catch (e) { /* offline – später erneut */ }
}

document.getElementById("reload-btn")?.addEventListener("click", hardReload);
check();
setInterval(check, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
globalThis.__sqzBuild = mine;
