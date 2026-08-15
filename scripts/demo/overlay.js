/* Injected before every document. Survives navigation. */
(() => {
  if (window.__nettDemo) return;

  const overlay = document.createElement("div");
  overlay.id = "nett-demo-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="nett-demo-cursor" data-cursor>
      <svg viewBox="0 0 32 32" width="56" height="56">
        <path d="M4 2.4l20.2 14.1-9.1 1.6 4.4 10.2-3.7 1.6-4.5-10.3-7.3 6.8z" fill="#f4f1ea" stroke="#1a1a1a" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="nett-demo-ripple" data-ripple></div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #nett-demo-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483646;
    }
    html, body, * { cursor: none !important; }
    #root {
      transform-origin: var(--nett-demo-ox, 50%) var(--nett-demo-oy, 50%);
      transform: scale(var(--nett-demo-scale, 1));
      transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .nett-demo-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 56px;
      height: 56px;
      transform: translate(-6px, -4px);
      filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.35));
      opacity: 0;
      will-change: left, top;
    }
    .nett-demo-cursor.is-on { opacity: 1; }
    .nett-demo-cursor.is-down { transform: translate(-6px, -4px) scale(0.86); }
    .nett-demo-ripple {
      position: fixed;
      width: 18px;
      height: 18px;
      margin: -9px 0 0 -9px;
      border-radius: 999px;
      border: 2px solid rgb(250 248 242 / 0.9);
      opacity: 0;
      pointer-events: none;
    }
    .nett-demo-ripple.is-on {
      animation: nett-demo-ripple 420ms ease-out;
    }
    @keyframes nett-demo-ripple {
      from { transform: scale(0.4); opacity: 0.9; }
      to { transform: scale(2.4); opacity: 0; }
    }
  `;

  const mount = () => {
    if (!document.documentElement.contains(style)) document.documentElement.append(style);
    if (!document.documentElement.contains(overlay)) document.documentElement.append(overlay);
  };
  mount();
  document.addEventListener("DOMContentLoaded", mount);

  const cursor = overlay.querySelector("[data-cursor]");
  const ripple = overlay.querySelector("[data-ripple]");
  let x = 80;
  let y = 80;
  let moving = null;

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

  const place = (nx, ny) => {
    x = nx;
    y = ny;
    cursor.style.left = `${nx}px`;
    cursor.style.top = `${ny}px`;
    cursor.classList.add("is-on");
  };

  const moveTo = (nx, ny, ms = 700) =>
    new Promise((resolve) => {
      if (moving) cancelAnimationFrame(moving);
      const sx = x;
      const sy = y;
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        const e = ease(t);
        place(sx + (nx - sx) * e, sy + (ny - sy) * e);
        if (t < 1) moving = requestAnimationFrame(step);
        else resolve();
      };
      moving = requestAnimationFrame(step);
    });

  const clickPulse = () => {
    cursor.classList.add("is-down");
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.classList.remove("is-on");
    void ripple.offsetWidth;
    ripple.classList.add("is-on");
    setTimeout(() => cursor.classList.remove("is-down"), 140);
  };

  const zoomTo = (cx, cy, scale = 1.16) => {
    const root = document.getElementById("root");
    document.documentElement.style.setProperty("--nett-demo-ox", `${cx}px`);
    document.documentElement.style.setProperty("--nett-demo-oy", `${cy}px`);
    document.documentElement.style.setProperty("--nett-demo-scale", String(scale));
    if (root) {
      root.style.transformOrigin = `${cx}px ${cy}px`;
      root.style.transform = `scale(${scale})`;
    }
  };

  const zoomReset = () => {
    const root = document.getElementById("root");
    document.documentElement.style.setProperty("--nett-demo-scale", "1");
    if (root) root.style.transform = "scale(1)";
  };

  place(x, y);
  window.__nettDemo = { moveTo, clickPulse, zoomTo, zoomReset, place };
})();
