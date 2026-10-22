// SQUIZZZzZ – bewegte Linien im Hintergrund („Ribbons“).
// Mehrere orange Bänder aus je mehreren Fäden, die sich langsam umeinander drehen.
// Nutzung: import { startRibbons } from "../js/ribbons.js"; startRibbons({ intensity: 1 });
// Rücksicht: „Bewegung reduzieren“ → stehendes Bild; pausiert, wenn der Tab nicht sichtbar ist.

export function startRibbons(options = {}) {
  const opts = {
    ribbons: 1,          // Anzahl Bänder (Martin: nur ein Strang)
    strands: 3,          // Fäden pro Band
    thickness: 1,        // Linienstärke-Faktor
    speed: 1,            // 1 = normal, 0.3 = ruhig (z. B. während einer Frage)
    intensity: 1,        // Helligkeit 0–1
    ...options,
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", width: "100%", height: "100%",
    zIndex: "-1", pointerEvents: "none",
  });
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1, t = Math.random() * 1000, last = performance.now(), raf = 0;

  // Zufällige, aber feste Eigenschaften je Band
  const bands = Array.from({ length: opts.ribbons }, (_, i) => ({
    y: opts.ribbons === 1 ? 0.7 : 0.18 + 0.64 * (i + 0.5) / opts.ribbons + (Math.random() - 0.5) * 0.08, // Grundhöhe (Anteil)
    amp: 0.09 + Math.random() * 0.04,     // Ausschlag (Anteil der Höhe)
    freq: 0.8 + Math.random() * 1.0,      // Wellen über die Breite
    drift: 0.12 + Math.random() * 0.18,   // Wandergeschwindigkeit
    twist: 0.35 + Math.random() * 0.35,   // Drehgeschwindigkeit der Fäden
    width: 0.035 + Math.random() * 0.01,  // Bandbreite (Anteil der Höhe)
    hue: 33,  // überwiegend Orange (#FF8E00 ≈ 33°), ab und zu rötlicher
    phase: Math.random() * Math.PI * 2,
  }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const step = Math.max(8, w / 120);
    const scale = Math.min(h, w * 0.9);                       // auf Hochformat (Handy) flacher
    const freqScale = Math.min(1, w / 900);                   // auf schmalen Screens weniger Wellen
    for (const b of bands) {
      for (let s = 0; s < opts.strands; s++) {
        const sp = (s / opts.strands) * Math.PI * 2;
        ctx.beginPath();
        let depthSum = 0, n = 0;
        for (let x = -step; x <= w + step; x += step) {
          const u = x / w;
          const f = b.freq * (0.5 + 0.5 * freqScale);
          const center = h * b.y + scale * (b.amp * Math.sin(u * f * Math.PI * 2 + t * b.drift + b.phase)
                               + b.amp * 0.4 * Math.sin(u * f * 5.1 + t * b.drift * 0.7));
          const angle = u * 6 + t * b.twist + sp + b.phase;   // Drehung des Fadens um die Bandmitte
          const y = center + Math.sin(angle) * scale * b.width;
          depthSum += Math.cos(angle); n++;
          x === -step ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const depth = (depthSum / n + 1) / 2;                 // vorne heller, hinten dunkler
        const alpha = (0.14 + 0.46 * depth) * opts.intensity;
        // weicher Schein …
        ctx.strokeStyle = `hsla(${b.hue}, 100%, 55%, ${alpha * 0.18})`;
        ctx.lineWidth = (10 + depth * 10) * opts.thickness;
        ctx.stroke();
        // … und heller Faden
        ctx.strokeStyle = `hsla(${b.hue}, 100%, ${58 + 17 * depth}%, ${alpha})`;
        ctx.lineWidth = (2 + depth * 3) * opts.thickness;
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt * opts.speed;
    draw();
    raf = requestAnimationFrame(frame);
  }

  function start() { if (!raf && !reduceMotion) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  resize(); draw();
  window.addEventListener("resize", () => { resize(); draw(); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();

  return {
    setSpeed(v) { opts.speed = v; },
    setIntensity(v) { opts.intensity = v; if (reduceMotion) draw(); },
    stop, start,
  };
}
