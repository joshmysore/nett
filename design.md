# Design - Nett

A locked design system for Nett. Every page and component must use this file as
the visual source of truth. Extend this system deliberately; do not invent
page-local themes.

## Product read

- Audience: one person maintaining a private relationship network on their Mac.
- Primary job: find, understand, and update a person without losing source evidence.
- Tone: calm technical. Private, exact, and useful.

## Genre

Modern-minimal product UI.

## Macrostructure family

- App pages: Workbench. Persistent navigation, one clear page heading, and a
  content-led grid that uses dividers and whitespace before containers.
- Setup pages: Guided workbench. A short progress rail beside one focused task.
- Content and evidence pages: Long document. Readable measure, stable section
  anchors, and dense evidence only where requested.

## Theme

Nett follows the operating-system appearance. Each page stays within one mode;
sections never invert independently.

Light:

- `--color-paper`: `oklch(97.5% 0.006 250)`
- `--color-paper-2`: `oklch(94.8% 0.008 250)`
- `--color-surface`: `oklch(99% 0.004 250)`
- `--color-ink`: `oklch(19% 0.015 255)`
- `--color-ink-2`: `oklch(42% 0.014 255)`
- `--color-muted`: `oklch(52% 0.012 255)`
- `--color-rule`: `oklch(85% 0.012 250)`
- `--color-rule-strong`: `oklch(74% 0.016 250)`
- `--color-accent`: `oklch(55% 0.16 255)`
- `--color-focus`: `oklch(60% 0.18 255)`

Dark:

- `--color-paper`: `oklch(15% 0.012 255)`
- `--color-paper-2`: `oklch(18.5% 0.014 255)`
- `--color-surface`: `oklch(21.5% 0.014 255)`
- `--color-ink`: `oklch(94% 0.006 250)`
- `--color-ink-2`: `oklch(76% 0.010 250)`
- `--color-muted`: `oklch(66% 0.012 250)`
- `--color-rule`: `oklch(31% 0.016 255)`
- `--color-rule-strong`: `oklch(42% 0.018 255)`
- `--color-accent`: `oklch(72% 0.14 250)`
- `--color-focus`: `oklch(77% 0.14 250)`

Accent is a signal, not a surface. It is limited to focus, selection, links,
small status marks, and data visualization.

## Typography

- Display and body: Geist Variable, 400 body and 650-700 headings.
- Mono: JetBrains Mono Variable for source labels, dates, and tabular metrics.
- Body anchor: 16 px with 1.55 line-height.
- UI controls: 14-15 px, never smaller.
- Metadata: 12-13 px only when secondary and still high contrast.
- Display tracking: `-0.025em`.
- Numbers use tabular figures.
- Headings are roman. No gradient or italic display text.

## Spacing

Use a 4-point named scale:

- `--space-3xs`: 0.25rem
- `--space-2xs`: 0.5rem
- `--space-xs`: 0.75rem
- `--space-sm`: 1rem
- `--space-md`: 1.5rem
- `--space-lg`: 2rem
- `--space-xl`: 3rem
- `--space-2xl`: 4.5rem

Prefer `gap` for sibling rhythm. Raw pixel spacing is reserved for one-pixel
rules and optical corrections.

## Shape

- Panels: 12 px radius.
- Inputs and buttons: 8 px radius.
- Status tags and avatars may be circular.
- One containment layer. No card inside card.

## Motion

- `--ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)`
- `--ease-in`: `cubic-bezier(0.7, 0, 0.84, 0)`
- `--ease-in-out`: `cubic-bezier(0.65, 0, 0.35, 1)`
- Micro feedback: 120 ms.
- Menus and small state changes: 220 ms.
- Drawers and dialogs: 300 ms.
- No page-wide reveal choreography, parallax, bounce, or ambient loops.
- Reduced motion removes spatial transitions and caps fades at 150 ms.

## Microinteractions

- Focus is immediate and always visible.
- Success is silent when the result is visible.
- Async failures remain next to the failed action and offer retry.
- Buttons press by one pixel; data cards do not lift.
- Hover behavior always has a focus and touch equivalent.
- Loading preserves the final layout and uses progress for long native imports.

## CTA voice

- Primary: ink-filled, paper text, short action verb.
- Secondary: surface fill with a visible rule.
- Tertiary: text action with an underline or icon.
- Labels never wrap.

## Onboarding

Onboarding creates a local owner workspace, not a cloud account. It explains
where data lives, then guides the user through Apple Contacts, Messages, and an
optional spreadsheet. Every step can be skipped and revisited in Sources.

## Per-page allowances

- App pages do not use decorative enrichment.
- Network visualizations may use the accent for meaningful edges and values.
- Evidence-heavy views may increase density, but never reduce readable type.

## What pages must share

- Tokens, typography, focus treatment, button hierarchy, and error language.
- App shell geometry and navigation labels.
- Source provenance presentation.
- Loading, empty, error, success, and disabled states.

## What pages may vary

- Grid proportions based on the work.
- Density for evidence and communication histories.
- Whether the page uses a side inspector or full profile view.

## Banned

- Glassmorphism and blurred decorative panels.
- Purple gradients, glow halos, gradient text, and animated backgrounds.
- Decorative uppercase eyebrows on every section.
- Equal three-card feature rows and nested cards.
- Text smaller than 12 px or low-contrast helper copy.
- Invented metrics or uncited model output.
- LinkedIn cookie reuse, credential capture, or stealth scraping.
