import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  /** RGB triple used for the glow, e.g. "91, 140, 255" */
  spotlightColor?: string;
};

/**
 * Quiet pointer spotlight for elevated surfaces.
 * Restrained for Nett — no rainbow border chrome.
 */
export function SpotlightCard({
  children,
  className,
  spotlightColor = "91, 140, 255",
  onMouseMove,
  ...props
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  const handleMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const node = ref.current;
      if (node) {
        const bounds = node.getBoundingClientRect();
        node.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
        node.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
      }
      onMouseMove?.(event);
    },
    [onMouseMove],
  );

  return (
    <div
      ref={ref}
      className={cn("spotlight-card", className)}
      style={{ "--spot-rgb": spotlightColor } as CSSProperties}
      onMouseMove={handleMove}
      {...props}
    >
      <span className="spotlight-card-glow" aria-hidden="true" />
      <div className="spotlight-card-inner">{children}</div>
    </div>
  );
}

type GlowColor = "blue" | "graphite" | "green" | "orange";

const glowColorMap: Record<GlowColor, { base: number; spread: number }> = {
  blue: { base: 250, spread: 28 },
  graphite: { base: 230, spread: 12 },
  green: { base: 155, spread: 20 },
  orange: { base: 55, spread: 18 },
};

/** One document pointer listener for every mounted GlowCard — avoids N× listeners on People. */
const glowNodes = new Set<HTMLElement>();
let glowPointerBound = false;

function syncGlowPointer(event: PointerEvent) {
  const x = event.clientX.toFixed(2);
  const xp = (event.clientX / window.innerWidth).toFixed(2);
  const y = event.clientY.toFixed(2);
  const yp = (event.clientY / window.innerHeight).toFixed(2);
  for (const node of glowNodes) {
    node.style.setProperty("--x", x);
    node.style.setProperty("--xp", xp);
    node.style.setProperty("--y", y);
    node.style.setProperty("--yp", yp);
  }
}

function registerGlowNode(node: HTMLElement) {
  glowNodes.add(node);
  if (!glowPointerBound) {
    document.addEventListener("pointermove", syncGlowPointer, { passive: true });
    glowPointerBound = true;
  }
}

function unregisterGlowNode(node: HTMLElement) {
  glowNodes.delete(node);
  if (glowNodes.size === 0 && glowPointerBound) {
    document.removeEventListener("pointermove", syncGlowPointer);
    glowPointerBound = false;
  }
}

type GlowCardProps = {
  children: ReactNode;
  className?: string;
  glowColor?: GlowColor;
  /** When true, sizing comes from className / parent — ignore fixed aspect. */
  customSize?: boolean;
  onClick?: () => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  tabIndex?: number;
  role?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
};

/**
 * Glow border spotlight card (21st.dev / fixed-attachment pattern),
 * toned to Nett's cobalt interaction accent — never purple SaaS chrome.
 */
export const GlowCard = forwardRef<HTMLDivElement, GlowCardProps>(function GlowCard(
  {
    children,
    className = "",
    glowColor = "blue",
    customSize = true,
    onClick,
    onKeyDown,
    tabIndex,
    role,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
  },
  forwardedRef,
) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const { base, spread } = glowColorMap[glowColor];

  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const node = localRef.current;
    if (!node) return;
    registerGlowNode(node);
    return () => unregisterGlowNode(node);
  }, []);

  const interactive = Boolean(onClick);

  return (
    <div
      ref={setRefs}
      data-glow
      role={role ?? (interactive ? "button" : undefined)}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      className={cn("glow-card", !customSize && "glow-card-fixed", className)}
      style={
        {
          "--base": base,
          "--spread": spread,
        } as CSSProperties
      }
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span data-glow aria-hidden="true" />
      <div className="glow-card-body">{children}</div>
    </div>
  );
});
