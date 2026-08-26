import { BorderBeam } from "border-beam";
import { MetalFx, type MetalFxVariant } from "metal-fx";
import { useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { ParticleReveal } from "@/components/canvasui/ParticleReveal";
import { askOrbState } from "@/lib/ask-orbs";
import { useAppearance } from "@/lib/theme";

function readSurfaceColor() {
  if (typeof document === "undefined") return "";
  return (
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
    || getComputedStyle(document.documentElement).backgroundColor
  );
}

export function AskBeam({
  children,
  loading = false,
  className,
}: {
  children: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const theme = useAppearance();
  const reduce = Boolean(useReducedMotion());
  return (
    <BorderBeam
      className={className}
      size="md"
      colorVariant="mono"
      staticColors
      theme={theme}
      borderRadius={16}
      duration={loading ? 2.6 : 5.6}
      strength={reduce ? 0 : loading ? 0.68 : 0.4}
      active={!reduce}
    >
      {children}
    </BorderBeam>
  );
}

export function AskMetal({
  children,
  variant = "button",
  className,
  strength = 0.82,
}: {
  children: ReactElement;
  variant?: MetalFxVariant;
  className?: string;
  strength?: number;
}) {
  const theme = useAppearance();
  const reduce = Boolean(useReducedMotion());
  return (
    <MetalFx
      className={className}
      variant={variant}
      preset="silver"
      theme={theme}
      strength={reduce ? Math.min(strength, 0.35) : strength}
      paused={reduce}
      disableGlow={reduce}
      normalizeHostStyles={false}
    >
      {children}
    </MetalFx>
  );
}

export function AskStageOrb({
  id,
  live,
}: {
  id: string;
  live: boolean;
}) {
  return (
    <ThinkingOrb
      className="ask-stage-orb"
      state={askOrbState(id)}
      size={20}
      paused={!live}
      aria-hidden="true"
    />
  );
}

export function AskReveal({ children }: { children: ReactNode }) {
  const theme = useAppearance();
  const [background, setBackground] = useState(readSurfaceColor);

  useEffect(() => {
    setBackground(readSurfaceColor());
  }, [theme]);

  return (
    <ParticleReveal
      className="ask-reveal"
      contentClassName="ask-reveal-content"
      contentStyle={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
      background={background}
      radius={420}
      softness={0.82}
      size={1}
      scatter={16}
      drift={0.4}
      aberration={8}
      bend={12}
      fade={0.5}
      threshold={0.08}
      smoothing={0.28}
    >
      {children}
    </ParticleReveal>
  );
}
