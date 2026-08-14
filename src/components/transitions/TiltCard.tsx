import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useRef,
} from "react";

type TiltCardProps = {
  children: ReactNode;
  className?: string;
  /** Max tilt in degrees. */
  maxTilt?: number;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Transitions.dev card hover tilt — pointer-tracked rotate + glare.
 * Outer `.t-tilt` stays flat; inner `.t-tilt-card` tilts.
 */
export function TiltCard({ children, className = "", maxTilt = 10 }: TiltCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    if (!root || !card) return;
    root.classList.remove("is-hover");
    card.classList.remove("is-tilting");
    card.style.setProperty("--tilt-rx", "0deg");
    card.style.setProperty("--tilt-ry", "0deg");
    card.style.setProperty("--tilt-gx", "50%");
    card.style.setProperty("--tilt-gy", "50%");
  }, []);

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion()) return;
    const root = rootRef.current;
    const card = cardRef.current;
    if (!root || !card) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const ry = (px - 0.5) * 2 * maxTilt;
    const rx = (0.5 - py) * 2 * maxTilt;

    root.classList.add("is-hover");
    card.classList.add("is-tilting");
    card.style.setProperty("--tilt-rx", `${rx.toFixed(2)}deg`);
    card.style.setProperty("--tilt-ry", `${ry.toFixed(2)}deg`);
    card.style.setProperty("--tilt-gx", `${(px * 100).toFixed(2)}%`);
    card.style.setProperty("--tilt-gy", `${(py * 100).toFixed(2)}%`);
  };

  return (
    <div
      ref={rootRef}
      className={["t-tilt", className].filter(Boolean).join(" ")}
      onPointerMove={onMove}
      onPointerEnter={onMove}
      onPointerLeave={reset}
      onPointerCancel={reset}
    >
      <div ref={cardRef} className="t-tilt-card">
        {children}
        <div className="t-tilt-glare" aria-hidden="true" />
      </div>
    </div>
  );
}
