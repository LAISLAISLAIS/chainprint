/**
 * Landing atmosphere — monochrome depth field.
 * Soft vignette + faint spectral silhouette in white/gray only.
 */

export function mountHeroMotion(canvas) {
  if (!canvas) return () => {};

  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let t0 = performance.now();

  const bars = [
    0.14, 0.28, 0.2, 0.42, 0.34, 0.55, 0.4, 0.7, 0.5, 0.62,
    0.86, 0.6, 0.74, 0.44, 0.64, 0.36, 0.5, 0.24, 0.4, 0.18,
    0.3, 0.14, 0.22, 0.1,
  ];

  function resize() {
    const parent = canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.floor(rect.width));
    h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);

    const phase = reduced ? 0 : t * 0.18;
    const breath = reduced ? 0.5 : Math.sin(t * 0.25) * 0.5 + 0.5;

    // Soft white bloom behind the hero stack
    const cy = h * 0.44;
    const glow = ctx.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, Math.max(w, h) * 0.38);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.04 + breath * 0.02})`);
    glow.addColorStop(0.5, "rgba(255, 255, 255, 0.01)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const n = bars.length;
    const fieldW = Math.min(w * 0.58, 480);
    const fieldH = Math.min(h * 0.22, 140);
    const left = (w - fieldW) / 2;
    const midY = h * 0.46;
    const gap = fieldW / n;
    const barW = Math.max(1.5, gap * 0.38);

    ctx.save();
    ctx.globalAlpha = 0.14 + breath * 0.05;

    for (let i = 0; i < n; i++) {
      const sway = reduced ? 0 : Math.sin(phase + i * 0.32) * 0.07;
      const amp = bars[i] * (0.94 + sway);
      const bh = fieldH * amp;
      const x = left + i * gap + (gap - barW) / 2;
      const alpha = 0.25 + bars[i] * 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.4})`;
      ctx.beginPath();
      const r = Math.min(barW / 2, 2);
      roundRect(ctx, x, midY - bh, barW, bh * 2, r);
      ctx.fill();
    }
    ctx.restore();

    raf = requestAnimationFrame(draw);
  }

  function roundRect(c, x, y, rw, rh, r) {
    const rr = Math.min(r, rw / 2, rh / 2);
    c.moveTo(x + rr, y);
    c.arcTo(x + rw, y, x + rw, y + rh, rr);
    c.arcTo(x + rw, y + rh, x, y + rh, rr);
    c.arcTo(x, y + rh, x, y, rr);
    c.arcTo(x, y, x + rw, y, rr);
    c.closePath();
  }

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}
