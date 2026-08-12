import { ArrowRight } from "@phosphor-icons/react";
import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router-dom";
import { LiquidGlassCard } from "@/components/ui/liquid-glass";
import { cn } from "@/lib/utils";

type LandingGlassCtaProps = {
  to: string;
  children?: ReactNode;
  /** Larger hero / close CTA. */
  primary?: boolean;
  /**
   * `ceremony` — light ink on dark landing chrome.
   * `paper` — dark ink on light About surfaces.
   */
  tone?: "ceremony" | "paper";
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function LandingGlassCta({
  to,
  children = (
    <>
      Open Nett
      <ArrowRight size={16} aria-hidden="true" />
    </>
  ),
  primary = false,
  tone = "ceremony",
  className,
  onClick,
}: LandingGlassCtaProps) {
  return (
    <LiquidGlassCard
      className={cn(
        "landing-glass-cta",
        primary && "landing-glass-cta--primary",
        tone === "paper" && "landing-glass-cta--paper",
        className,
      )}
      blurIntensity={primary ? "lg" : "md"}
      glowIntensity="none"
      shadowIntensity={tone === "paper" ? "sm" : "xs"}
      borderRadius="var(--control-radius, 10px)"
    >
      <Link className="landing-glass-cta__link" to={to} onClick={onClick}>
        {children}
      </Link>
    </LiquidGlassCard>
  );
}
