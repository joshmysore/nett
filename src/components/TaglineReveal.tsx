import type { ElementType } from "react";

export const LANDING_TAGLINE = "Use tech to remind what makes you human.";
export const LANDING_TAGLINE_SUB = "The tip of your tongue is now yours.";

type TaglineRevealProps = {
  as?: "h1" | "h2";
  id: string;
  text?: string;
};

export function TaglineReveal({
  as: Comp = "h2",
  id,
  text = LANDING_TAGLINE,
}: TaglineRevealProps) {
  const Heading = Comp as ElementType;
  const human = "human.";
  const before = text.endsWith(human) ? text.slice(0, -human.length) : text;

  return (
    <div className="landing-tagline">
      <Heading id={id}>
        {before}
        <em>{human}</em>
      </Heading>
    </div>
  );
}
