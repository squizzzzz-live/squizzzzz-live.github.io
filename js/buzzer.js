// Buzzernamen: eingesprochene Namen (sounds/buzzer/*.mp3), automatische Zuordnung, Sprachausgabe als Ersatz.
const BASE = new URL("../sounds/buzzer/", import.meta.url);
let list = null;

export async function buzzerList() {
  if (!list) { try { list = await (await fetch(new URL("index.json", BASE))).json(); } catch { list = []; } }
  return list;
}

// „Günter“ ↔ „Guenter“, „Rüdi“ ↔ „Ruedi“ usw.
const norm = (s) => String(s || "").toLowerCase().trim()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9-]/g, "");

/** Passenden Buzzernamen zu einem Spielernamen finden (ganzer Name, sonst Vorname). */
export function matchBuzzer(name, files = list || []) {
  const full = norm(name), first = norm(String(name || "").split(/\s+/)[0]);
  return files.find((f) => norm(f) === full) || files.find((f) => norm(f) === first) || null;
}

/** Buzzername abspielen; ohne Datei spricht der Mac/das Gerät den Namen. */
export function playBuzzer(file, name) {
  if (file) {
    const a = new Audio(new URL(encodeURIComponent(file) + ".mp3", BASE));
    return a.play().catch(() => speak(name));
  }
  return speak(name);
}

export function speak(name) {
  if (!("speechSynthesis" in window) || !name) return Promise.resolve();
  const u = new SpeechSynthesisUtterance(`${name}!`);
  u.lang = "de-DE"; u.pitch = 1.35; u.rate = 1.08; u.volume = 1;
  const de = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("de"));
  if (de) u.voice = de;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
  return Promise.resolve();
}
