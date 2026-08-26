import type { MouseEventHandler, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type LandingParenLinkProps = {
  to: string;
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  current?: boolean;
};

/** Parenthetical text link with a vertical roll on hover, from the DesEngs index pattern. */
export function LandingParenLink({
  to,
  children,
  className,
  onClick,
  current,
}: LandingParenLinkProps) {
  const label = typeof children === "string" ? children : undefined;

  return (
    <Link
      className={cn("landing-paren", className)}
      to={to}
      onClick={onClick}
      aria-label={label}
      aria-current={current ? "page" : undefined}
    >
      (
      <span className="landing-paren__slot" aria-hidden={label ? true : undefined}>
        <span>{children}</span>
        <span>{children}</span>
      </span>
      )
    </Link>
  );
}
