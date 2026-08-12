import { cn } from "@/lib/utils";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useId,
  useState,
} from "react";

type BlurIntensity = "sm" | "md" | "lg" | "xl";
type LayerIntensity = "none" | "xs" | "sm" | "md" | "lg" | "xl";

const BLUR_PX: Record<BlurIntensity, number> = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
};

/** Soft elevation only — no neon rings (design.md glass rules). */
const GLOW: Record<LayerIntensity, string> = {
  none: "0 4px 16px color-mix(in oklch, var(--shadow, oklch(19% 0.015 255 / 0.13)) 55%, transparent)",
  xs: "0 6px 20px color-mix(in oklch, var(--shadow, oklch(19% 0.015 255 / 0.13)) 70%, transparent)",
  sm: "0 8px 24px color-mix(in oklch, var(--shadow, oklch(19% 0.015 255 / 0.13)) 80%, transparent)",
  md: "0 10px 28px color-mix(in oklch, var(--shadow, oklch(19% 0.015 255 / 0.13)) 90%, transparent)",
  lg: "0 12px 32px var(--shadow, oklch(19% 0.015 255 / 0.13))",
  xl: "0 14px 36px var(--shadow, oklch(19% 0.015 255 / 0.13))",
};

const INNER_EDGE: Record<LayerIntensity, string> = {
  none: "none",
  xs: "inset 0 0 0 1px color-mix(in oklch, var(--landing-ink, var(--text)) 12%, transparent)",
  sm: "inset 1px 1px 0 color-mix(in oklch, var(--landing-ink, var(--text)) 18%, transparent), inset -1px -1px 0 color-mix(in oklch, var(--landing-ink, var(--text)) 8%, transparent)",
  md: "inset 1px 1px 1px color-mix(in oklch, var(--landing-ink, var(--text)) 22%, transparent), inset -1px -1px 1px color-mix(in oklch, var(--landing-ink, var(--text)) 10%, transparent)",
  lg: "inset 2px 2px 2px color-mix(in oklch, var(--landing-ink, var(--text)) 24%, transparent), inset -2px -2px 2px color-mix(in oklch, var(--landing-ink, var(--text)) 12%, transparent)",
  xl: "inset 2px 2px 3px color-mix(in oklch, var(--landing-ink, var(--text)) 28%, transparent), inset -2px -2px 3px color-mix(in oklch, var(--landing-ink, var(--text)) 14%, transparent)",
};

export type LiquidGlassCardProps = {
  children: ReactNode;
  className?: string;
  /** Motion drag. Default false — landing glass menus stay put. */
  draggable?: boolean;
  expandable?: boolean;
  width?: string;
  height?: string;
  expandedWidth?: string;
  expandedHeight?: string;
  blurIntensity?: BlurIntensity;
  shadowIntensity?: LayerIntensity;
  borderRadius?: string;
  /** Default none. Prefer none | xs only; stronger values stay non-neon. */
  glowIntensity?: LayerIntensity;
  /** SVG feDisplacementMap distortion. Off by default — hurts text legibility. */
  distortion?: boolean;
};

export function LiquidGlassCard({
  children,
  className,
  draggable = false,
  expandable = false,
  width,
  height,
  expandedWidth,
  expandedHeight,
  blurIntensity = "lg",
  borderRadius = "var(--glass-radius, 22px)",
  glowIntensity = "none",
  shadowIntensity = "sm",
  distortion = false,
}: LiquidGlassCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const filterId = useId().replace(/:/g, "");
  const useMotion = draggable || expandable;

  const handleToggleExpansion = (event: MouseEvent<HTMLDivElement>) => {
    if (!expandable) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a, button, input, select, textarea, [role='button']")) return;
    setIsExpanded((prev) => !prev);
  };

  const blurPx = BLUR_PX[blurIntensity];
  const layerStyle = {
    borderRadius,
    ["--nett-glass-blur" as string]: `${blurPx}px`,
    ["--nett-glass-glow" as string]: GLOW[glowIntensity],
    ["--nett-glass-shadow" as string]: INNER_EDGE[shadowIntensity],
  } as CSSProperties;

  const sizeStyle: CSSProperties = {
    borderRadius,
    ...(width && !expandable ? { width } : null),
    ...(height && !expandable ? { height } : null),
  };

  const classNames = cn(
    "nett-liquid-glass",
    draggable && "nett-liquid-glass--draggable",
    expandable && "nett-liquid-glass--expandable",
    className,
  );

  const bend = (
    <div
      className="nett-liquid-glass__bend"
      style={{
        borderRadius,
        ...(distortion ? { filter: `url(#${filterId})` } : null),
      }}
      aria-hidden="true"
    />
  );

  const face = (
    <div className="nett-liquid-glass__face" style={{ borderRadius }} aria-hidden="true" />
  );

  const edge = (
    <div className="nett-liquid-glass__edge" style={{ borderRadius }} aria-hidden="true" />
  );

  const content = <div className="nett-liquid-glass__content">{children}</div>;

  const filterSvg = distortion ? (
    <svg className="nett-liquid-glass__filter" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id={filterId}
          x="0"
          y="0"
          width="100%"
          height="100%"
          filterUnits="objectBoundingBox"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.003 0.007"
            numOctaves="1"
            result="turbulence"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="turbulence"
            scale="12"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  ) : null;

  if (!useMotion) {
    return (
      <>
        {filterSvg}
        <div className={classNames} style={{ ...sizeStyle, ...layerStyle }}>
          {bend}
          {face}
          {edge}
          {content}
        </div>
      </>
    );
  }

  const duration = reduceMotion ? 0.15 : 0.4;
  const motionProps: HTMLMotionProps<"div"> = {
    ...(expandable
      ? {
          animate: isExpanded
            ? {
                width: expandedWidth ?? "auto",
                height: expandedHeight ?? "auto",
              }
            : {
                width: width ?? "auto",
                height: height ?? "auto",
              },
          transition: {
            duration,
            ease: reduceMotion ? "linear" : ([0.22, 0.8, 0.24, 1] as const),
          },
          onClick: handleToggleExpansion,
        }
      : null),
    ...(draggable
      ? {
          drag: true as const,
          dragConstraints: { left: 0, right: 0, top: 0, bottom: 0 },
          dragElastic: reduceMotion ? 0 : 0.3,
          dragTransition: {
            bounceStiffness: 300,
            bounceDamping: 10,
            power: 0.3,
          },
          whileDrag: reduceMotion ? undefined : { scale: 1.02 },
        }
      : null),
    whileHover: reduceMotion ? undefined : { scale: 1.01 },
    whileTap: reduceMotion ? undefined : { scale: 0.98 },
  };

  return (
    <>
      {filterSvg}
      <motion.div
        className={classNames}
        style={{ ...sizeStyle, ...layerStyle }}
        {...motionProps}
      >
        {bend}
        {face}
        {edge}
        {content}
      </motion.div>
    </>
  );
}
