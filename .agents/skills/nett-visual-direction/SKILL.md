---
name: nett-visual-direction
description: "Enforce Nett's locked visual system and remove generated-SaaS styling. Use before and after any change to src/index.css, any page or component that renders UI, or when the interface looks like an AI dashboard, a landing page, or a card grid."
version: 1.0.0
---

# Nett visual direction

`design.md` is the source of truth. This skill exists because the CSS has drifted
from it before — a purple accent, glass panels, 7 px type, and three stacked
override blocks all shipped while `design.md` said otherwise.

## When this runs

Before editing any file that produces pixels, and again before declaring the
change done.

## Step 1 — Audit before editing

Do not start by writing CSS. Start by looking.

1. Run the app. Screenshot the surface you are about to change at 1440 and
   375 px, in **both** light and dark.
2. Open `design.md` beside the screenshots.
3. List every concrete contradiction. Name the selector and the rule.
4. Fix contradictions in the token and primitive layer first. Page-level
   overrides are the last resort, not the first.

`node scripts/measure.mjs <label>` captures the full 7-viewport × 2-scheme grid
into `docs/audits/<label>-screens/` if you need the whole set.

## Step 2 — Required

- Tokens from `design.md`, OKLCH, defined once, complete in light **and** dark.
  Nett follows the OS appearance. A page never mixes modes.
- Geist for interface typography.
- JetBrains Mono **only** for genuinely tabular or source-oriented values:
  dates, counts, identifiers, confidence figures. Never body copy, never section
  labels, never buttons.
- One primary containment layer. If you are inside a panel, you may not open
  another panel.
- Hierarchy from type scale, alignment, dividers, and whitespace — in that
  order — before reaching for a border, and long before reaching for a card.
- A restrained accent. Focus, selection, links, small status marks. Not a
  surface, not a wash, not a gradient.
- Complete interaction states for every control: rest, hover, focus-visible,
  active, disabled, loading, error.
- Visible keyboard focus everywhere, including inside dialogs and lists.
- Normal text 14–16 px. Secondary metadata 12–13 px.
  **No meaningful interface text below 12 px.**
- Progressive disclosure for uncommon metadata. If a field is filled on fewer
  than a third of records, it does not belong above the fold.

## Step 3 — Banned by default

Purple and lavender gradients · AI-panel violet treatments · glow halos ·
blur halos · `backdrop-filter` glass panels · nested cards · pill controls used
as general-purpose containers · giant marketing headings on app routes ·
repetitive uppercase section kickers · fake dashboard metrics · decorative
network diagrams · charts that answer no question · celebratory effects ·
animation that delays access to content · every field rendered at equal
prominence.

If you believe an exception is warranted, it must be added to `design.md` first,
with a reason.

## Step 4 — Verify

Re-screenshot the same surfaces at the same widths in both modes and compare
against the before set. Then answer all six of these in writing:

1. Does this feel personal rather than corporate?
2. Can a person be recognised rapidly — by name, face-substitute, and one
   distinguishing fact — without reading every row?
3. Is important information visible without opening a form?
4. Is the hierarchy obvious without decorative containers?
5. Does mobile feel designed, or merely compressed?
6. Is any remaining styling generic or ornamental?

A "no" to 1–5, or a "yes" to 6, is a defect. Fix it before moving on.

## Acceptance criteria

- Zero contradictions with `design.md` remain in the changed surface.
- Light and dark screenshots exist and differ.
- No new hardcoded colour literals. Everything references a token.
- No new rules below 12 px.
- No new override block appended to the bottom of `src/index.css`.
