import type { MouseEventHandler, ReactNode } from "react";
import { LandingParenLink } from "@/components/LandingParenLink";

type LandingGlassCtaProps = {
  to: string;
  children?: ReactNode;
  primary?: boolean;
  tone?: "ceremony" | "paper";
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

/** Kept export name for existing landing call sites. Renders a parenthetical text link. */
export function LandingGlassCta({
  to,
  children = "Open Nett",
  className,
  onClick,
}: LandingGlassCtaProps) {
  return (
    <LandingParenLink to={to} onClick={onClick} className={className}>
      {children}
    </LandingParenLink>
  );
}
