// Buzzernamen: eingesprochene Namen (sounds/buzzer/*.mp3), automatische Zuordnung, Sprachausgabe als Ersatz.
// Ton wird einmal per Klick freigeschaltet ("Ton an") – danach spielt Safari/Chrome auch Töne, die durch einen Buzz aus dem Netz ausgelöst werden.
const BASE = new URL("../sounds/buzzer/", import.meta.url);
let list = null, actx = null, unlocked = false;
const buffers = {};
const listeners = new Set();

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

export const audioUnlocked = () => unlocked && actx?.state === "running";
export function onAudioChange(fn) { listeners.add(fn); fn(audioUnlocked()); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((fn) => fn(audioUnlocked()));

/** Muss direkt aus einem Klick heraus aufgerufen werden. Schaltet Ton frei und lädt alle Buzzernamen vor. */
export async function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!actx && AC) actx = new AC();
  if (actx) {
    if (actx.state !== "running") await actx.resume().catch(() => {});
    const b = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource(); // stiller Ton = Freigabe
    src.buffer = b; src.connect(actx.destination); src.start(0);
  }
  try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch {}
  unlocked = true; notify();
  preload();
  return audioUnlocked();
}

async function preload() {
  if (!actx) return;
  const files = await buzzerList();
  await Promise.all(files.map(async (f) => {
    if (buffers[f]) return;
    try {
      const data = await (await fetch(new URL(encodeURIComponent(f) + ".mp3", BASE))).arrayBuffer();
      buffers[f] = await new Promise((res, rej) => actx.decodeAudioData(data, res, rej));
    } catch {}
  }));
}

// Safari setzt den Audio-Kanal nach Tab-Wechseln gern auf "suspended" → beim Zurückkommen fortsetzen
document.addEventListener("visibilitychange", () => { if (!document.hidden && actx && unlocked) actx.resume().then(notify, notify); });

/** Buzzername abspielen; ohne Datei spricht der Mac den Namen. */
export function playBuzzer(file, name) {
  if (file && actx && buffers[file] && actx.state === "running") {
    const src = actx.createBufferSource(); src.buffer = buffers[file]; src.connect(actx.destination); src.start(0);
    globalThis.__sqzLastPlay = { mode: "buffer", file };
    return Promise.resolve();
  }
  globalThis.__sqzLastPlay = { mode: file ? "element" : "speech", file, name };
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
