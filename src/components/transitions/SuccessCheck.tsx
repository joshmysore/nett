import { useEffect, useLayoutEffect, useRef, useState } from "react";

type SuccessCheckProps = {
  /** When true, runs the appear animation. */
  active?: boolean;
  size?: number;
  className?: string;
  /** toast = compact; stage = larger setup/import. */
  variant?: "toast" | "stage" | "default";
};

/**
 * Transitions.dev success check — fade + rotate + blur + Y-bob + stroke draw.
 * Own colors via currentColor / parent CSS.
 */
export function SuccessCheck({
  active = true,
  size = 20,
  className = "",
  variant = "default",
}: SuccessCheckProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [state, setState] = useState<"out" | "in">("out");

  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = Math.ceil(path.getTotalLength());
    path.style.setProperty("--check-path-length", String(length));
  }, []);

  useEffect(() => {
    if (!active) {
      setState("out");
      return;
    }
    // Next frame so data-state="out" paints first, then "in" triggers animation.
    const id = requestAnimationFrame(() => setState("in"));
    return () => cancelAnimationFrame(id);
  }, [active]);

  const variantClass =
    variant === "toast"
      ? "t-success-check--toast"
      : variant === "stage"
        ? "t-success-check--stage"
        : "";

  return (
    <span
      className={["t-success-check", variantClass, className].filter(Boolean).join(" ")}
      data-state={state}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
        <path
          ref={pathRef}
          d="M12 24.5 20.5 33 36 15"
          stroke="currentColor"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
