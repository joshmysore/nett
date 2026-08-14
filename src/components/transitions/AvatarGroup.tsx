import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useRef,
} from "react";

type AvatarGroupProps = {
  children: ReactNode;
  className?: string;
  /** Accessible name for the group. */
  label: string;
};

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readCssNumber(el: HTMLElement, name: string, fallback: number) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Transitions.dev avatar-group hover — distance-falloff lift + active scale.
 * Also mirrors on keyboard focus within an avatar.
 */
export function AvatarGroup({ children, className = "", label }: AvatarGroupProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((activeIdx: number | null, ease: "in" | "out") => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const items = [...root.querySelectorAll<HTMLElement>(".t-avatar")];
    if (!items.length) return;

    const lift = readCssNumber(root, "--avatar-lift", -5);
    const scale = readCssNumber(root, "--avatar-scale", 1.06);
    const falloff = readCssNumber(root, "--avatar-falloff", 0.45);
    const easeVar = ease === "in" ? "var(--avatar-ease-in)" : "var(--avatar-ease-out)";

    items.forEach((el, i) => {
      el.style.transitionTimingFunction = easeVar;
      if (activeIdx === null) {
        el.style.setProperty("--shift", "0px");
        el.style.setProperty("--scale-active", "1");
        return;
      }
      const distance = Math.abs(i - activeIdx);
      el.style.setProperty(
        "--shift",
        `${(lift * Math.pow(falloff, distance)).toFixed(3)}px`,
      );
      el.style.setProperty("--scale-active", i === activeIdx ? String(scale) : "1");
    });
  }, []);

  const indexFromTarget = (target: EventTarget | null) => {
    const root = rootRef.current;
    if (!root || !(target instanceof Element)) return null;
    const item = target.closest(".t-avatar");
    if (!item || !root.contains(item)) return null;
    return [...root.querySelectorAll(".t-avatar")].indexOf(item);
  };

  const onEnter = (event: MouseEvent<HTMLDivElement>) => {
    const idx = indexFromTarget(event.target);
    if (idx === null) return;
    apply(idx, "in");
  };

  const onLeave = () => apply(null, "out");

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const idx = indexFromTarget(event.target);
    if (idx === null) return;
    apply(idx, "in");
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    apply(null, "out");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    apply(null, "out");
  };

  return (
    <div
      ref={rootRef}
      className={["t-avatar-group", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      onMouseEnter={onEnter}
      onMouseMove={onEnter}
      onMouseLeave={onLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}

export function AvatarItem({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={["t-avatar", className].filter(Boolean).join(" ")}>{children}</div>;
}
