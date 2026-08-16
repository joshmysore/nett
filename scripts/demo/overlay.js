/* Injected before every document. Survives navigation. Lazy-mounts the HUD. */
(() => {
  if (window.__nettDemo) return;

  let cursor = null;
  let ripple = null;
  let x = 80;
  let y = 80;
  let moving = null;

  const css = `
    #nett-demo-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483646;
    }
    html.nett-demo-on, html.nett-demo-on body, html.nett-demo-on * { cursor: none !important; }
    html.nett-demo-on body { overflow: hidden; }
    .landing-spline-scene { display: none !important; }
    #root {
      transform-origin: var(--nett-demo-ox, 50%) var(--nett-demo-oy, 50%);
      transform: scale(var(--nett-demo-scale, 1));
      transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 520ms ease;
      animation: nett-demo-enter 640ms ease;
      will-change: transform;
    }
    @keyframes nett-demo-enter {
      from { opacity: 0.55; }
      to { opacity: 1; }
    }
    .nett-demo-cursor {
      position: fixed;
      left: 0;
      top: 0;
      width: 80px;
      height: 80px;
      transform: translate(-8px, -5px);
      filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.45));
      opacity: 0;
      will-change: left, top;
    }
    .nett-demo-cursor.is-on { opacity: 1; }
    .nett-demo-cursor.is-down { transform: translate(-8px, -5px) scale(0.82); }
    .nett-demo-ripple {
      position: fixed;
      width: 28px;
      height: 28px;
      margin: -14px 0 0 -14px;
      border-radius: 999px;
      border: 3px solid rgb(250 248 242 / 0.95);
      box-shadow: 0 0 0 8px rgb(250 248 242 / 0.18);
      opacity: 0;
      pointer-events: none;
    }
    .nett-demo-ripple.is-on { animation: nett-demo-ripple 520ms ease-out; }
    @keyframes nett-demo-ripple {
      from { transform: scale(0.35); opacity: 1; }
      to { transform: scale(2.8); opacity: 0; }
    }
  `;

  const mount = () => {
    const root = document.documentElement;
    if (!root || cursor) return Boolean(cursor);
    const style = document.createElement("style");
    style.textContent = css;
    const overlay = document.createElement("div");
    overlay.id = "nett-demo-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="nett-demo-cursor" data-cursor>
        <svg viewBox="0 0 32 32" width="80" height="80">
          <path d="M4 2.4l20.2 14.1-9.1 1.6 4.4 10.2-3.7 1.6-4.5-10.3-7.3 6.8z" fill="#f4f1ea" stroke="#1a1a1a" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="nett-demo-ripple" data-ripple></div>
    `;
    root.append(style, overlay);
    root.classList.add("nett-demo-on");
    cursor = overlay.querySelector("[data-cursor]");
    ripple = overlay.querySelector("[data-ripple]");
    if (cursor) {
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
      cursor.classList.add("is-on");
    }
    return Boolean(cursor);
  };

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

  const place = (nx, ny) => {
    mount();
    x = nx;
    y = ny;
    if (!cursor) return;
    cursor.style.left = `${nx}px`;
    cursor.style.top = `${ny}px`;
    cursor.classList.add("is-on");
  };

  const moveTo = (nx, ny, ms = 700) =>
    new Promise((resolve) => {
      mount();
      if (moving) clearTimeout(moving);
      const sx = x;
      const sy = y;
      const started = Date.now();
      const duration = Math.max(ms, 1);
      const step = () => {
        const t = Math.min(1, (Date.now() - started) / duration);
        const e = ease(t);
        place(sx + (nx - sx) * e, sy + (ny - sy) * e);
        if (t < 1) moving = setTimeout(step, 16);
        else resolve();
      };
      step();
    });

  const clickPulse = () => {
    mount();
    if (cursor) cursor.classList.add("is-down");
    if (ripple) {
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.classList.remove("is-on");
      void ripple.offsetWidth;
      ripple.classList.add("is-on");
    }
    setTimeout(() => cursor && cursor.classList.remove("is-down"), 160);
  };

  const zoomTo = (cx, cy, scale = 1.42) => {
    const app = document.getElementById("root");
    const ox = `${Math.round(cx)}px`;
    const oy = `${Math.round(cy)}px`;
    document.documentElement?.style.setProperty("--nett-demo-ox", ox);
    document.documentElement?.style.setProperty("--nett-demo-oy", oy);
    document.documentElement?.style.setProperty("--nett-demo-scale", String(scale));
    if (app) {
      app.style.transformOrigin = `${ox} ${oy}`;
      app.style.transform = `scale(${scale})`;
    }
  };

  const zoomReset = () => {
    const app = document.getElementById("root");
    document.documentElement?.style.setProperty("--nett-demo-scale", "1");
    if (app) app.style.transform = "scale(1)";
  };

  window.__nettDemo = { moveTo, clickPulse, zoomTo, zoomReset, place, mount };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
