# Visual review

Run before and after any change that produces pixels.
Skill: `.agents/skills/nett-visual-direction/SKILL.md`.

Parked (do not run until asked): Elaya `landing-page-design` and
`redesign-existing-projects` in `.agents/skills/`. Those are for a later
landing-page pass, not for workbench visual review.

## Before

- [ ] `npm run dev`
- [ ] Screenshot the surface at 1440 and 375, light and dark.
      `node scripts/measure.mjs before` captures the full grid.
- [ ] Open `design.md` beside the screenshots.
- [ ] List each contradiction by selector and rule.

## Fix order

1. Token layer — is the value even defined correctly, in both modes?
2. Primitive layer — is the shared component wrong?
3. Page layer — last resort only.

Never append a new override block to the bottom of `src/index.css`.

## Checklist

- [ ] Tokens only. No new colour literals.
- [ ] Both light and dark complete; the page does not mix modes.
- [ ] Geist for interface type. JetBrains Mono only for tabular or source values.
- [ ] Body 14–16 px, metadata 12–13 px, **nothing below 12 px**.
- [ ] One containment layer. No card in a card.
- [ ] Hierarchy from type, alignment, dividers, whitespace — before borders.
- [ ] Accent used as signal only.
- [ ] All states present: rest, hover, focus-visible, active, disabled, loading, error.
- [ ] Uncommon metadata behind progressive disclosure.

## Banned — confirm absent

purple/lavender gradients · violet AI treatments · glow halos · blur halos ·
glass panels · nested cards · pill-as-container · giant marketing headings on app
routes · uppercase kickers on every section · fake metrics · decorative network
diagrams · charts answering no question · celebratory effects · animation
delaying access · every field at equal prominence

## After

- [ ] Re-screenshot the same surfaces, both modes. Compare to before.
- [ ] Answer in writing:
  1. Personal rather than corporate?
  2. Can a person be recognised rapidly?
  3. Important information visible without a form?
  4. Hierarchy obvious without containers?
  5. Mobile designed, not compressed?
  6. Any remaining styling generic or ornamental?

A "no" to 1–5, or a "yes" to 6, is a defect. Fix it now.
