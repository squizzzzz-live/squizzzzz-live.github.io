// SQUIZZZzZ – bewegte Lichtlinien im Hintergrund.
// 1:1 nach dem Vorbild des Vokabeltrainers „Vocab Upgrade“ (squizzzzzmartin/vokabeltrainer, index.html):
// 7 leuchtende Linien in SQUIZZZzZ-Orange, oberer Bildbereich (520 px), leicht ansteigend.
// Nutzung: import { startRibbons } from "../js/ribbons.js"; startRibbons();
// Rücksicht: „Bewegung reduzieren“ → stehendes Bild; pausiert, wenn der Tab nicht sichtbar ist.

export function startRibbons(options = {}) {
  const opts = { height: 520, speed: 1, ...options };

  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, { position: "fixed", inset: "0", zIndex: "-1", pointerEvents: "none" });
  const c = document.createElement("canvas");
  Object.assign(c.style, { position: "absolute", left: "0", top: "0", width: "100%", height: opts.height + "px", opacity: ".9" });
  stage.appendChild(c);
  document.body.prepend(stage);
  const x = c.getContext("2d");

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, dpr, raf = 0, t = 0, last = 0;
  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = c.clientWidth; h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const lines = [...Array(7)].map((_, i) => ({
    a: 18 + i * 7, f: .0016 + i * .00023, p: i * 1.3, y: .52 + i * .035, o: .3 + (i % 3) * .16, wd: i % 3 ? 1.2 : 2,
  }));

  function draw() {
    x.clearRect(0, 0, w, h);
    for (const l of lines) {
      x.beginPath();
      for (let px = -20; px <= w + 20; px += 8) {
        const py = h * l.y + Math.sin(px * l.f * 2.2 + l.p + t * .00025) * l.a
                 + Math.sin(px * l.f * .9 - t * .00015 + l.p) * l.a * .8 - (px / w) * h * .18;
        px < 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.strokeStyle = `rgba(255,${150 + Math.round(l.o * 120)},40,${l.o})`;
      x.lineWidth = l.wd;
      x.shadowColor = "rgba(255,142,0,.9)"; x.shadowBlur = 12;
      x.stroke();
    }
  }

  function frame(now) {
    t += (last ? now - last : 0) * opts.speed; last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && !still) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  size(); draw();
  addEventListener("resize", () => { size(); draw(); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();

  return { setSpeed(v) { opts.speed = v; }, start, stop };
}
