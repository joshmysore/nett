# Design - Nett

A locked design system for Nett. Every page and component must use this file as
the visual source of truth. Extend this system deliberately; do not invent
page-local themes.

## Product read

- Audience: one person maintaining a private relationship network on their Mac.
- Primary job: recognise a person, recover why they matter, and update the
  record without losing source evidence.
- Tone: a private instrument — calm, exact, local, technical but human.
- Optimise for recognition and retrieval, never relationship management.

## Core visual thesis

The recurring motif is the **held thread**: a precise continuous trace that
connects a remembered fact to its evidence. It may appear in the N monogram,
quiet rules, search transitions, timeline rails, provenance affordances, and
loading states. It must never become a decorative node graph.

The material hierarchy is:

1. black / paper structure
2. purposeful glass above information
3. graphite
4. restrained cobalt interaction
5. extremely rare crystal refraction and royal purple

## Genre

Modern-minimal product UI with a quiet, cinematic landing surface.

## Macrostructure family

- App pages: Workbench. Persistent navigation, one clear page heading, and a
  content-led grid that uses dividers and whitespace before containers. Same
  paper, hairline, and type language as the landing — Geist, not display serif.
- Landing: Index-first recognition sequence. Human-scale serif display, Geist
  body, construction lines, parenthetical links, FAQ as a numbered list.
  Open Nett goes to Ask.
- First use: Open Nett. Sources and People hold import and gap-filling. There
  is no branded setup ceremony. `/setup` remains a deep link and redirects to
  Ask.
- Content and evidence pages: Long document. Readable measure, stable section
  anchors, and dense evidence only where requested.

## Theme

Nett follows the operating-system appearance. Each page stays within one mode;
sections never invert independently.

Light:

- `--color-paper`: `oklch(97.5% 0.004 286)`
- `--color-paper-2`: `oklch(95% 0.005 286)`
- `--color-surface`: `oklch(99% 0.002 286)`
- `--color-ink`: `oklch(19% 0.01 286)`
- `--color-ink-2`: `oklch(42% 0.01 286)`
- `--color-muted`: `oklch(44% 0.01 286)`
- `--color-rule`: `oklch(86% 0.008 286)`
- `--color-rule-strong`: `oklch(74% 0.01 286)`
- `--color-accent`: `oklch(28% 0.02 286)`
- `--color-focus`: `oklch(35% 0.03 286)`
- `--color-brand-purple`: `oklch(42% 0.18 305)` (Royal Purple — brand absorption only)

Dark:

- `--color-paper`: `oklch(6.3% 0.005 286)`
- `--color-paper-2`: `oklch(12% 0.006 286)`
- `--color-surface`: `oklch(16% 0.007 286)`
- `--color-ink`: `oklch(98.5% 0 0)`
- `--color-ink-2`: `oklch(72% 0.014 286)`
- `--color-muted`: `oklch(62% 0.014 286)`
- `--color-rule`: `oklch(22% 0.006 286)`
- `--color-rule-strong`: `oklch(32% 0.008 286)`
- `--color-accent`: `oklch(92% 0.01 286)`
- `--color-focus`: `oklch(85% 0.02 286)`
- `--color-brand-purple`: `oklch(58% 0.16 305)`

Accent is a signal for focus, selection, links, and status. Brand purple is
reserved for rare crystal refraction and local-compute brand moments — never
standard buttons.

## Brand mark

- The supplied `public/brand/nett-crystal-n.png` is the ceremonial mark. Use it
  only on the landing.
- Everyday product chrome uses a restrained continuous-line N monogram and the
  `Nett` wordmark. The wordmark is Geist 400–450, tightly tracked, with generous
  air between symbol and word.
- Official lockups are the N monogram, stacked `N / Nett`, and horizontal
  `N     Nett`.
- Do not reproduce the crystal material on ordinary controls, rows, or cards.

## Typography

- Display and body: Geist Variable on the workbench. Landing display is
  Instrument Serif; landing body is Geist. Workbench page titles are 500;
  section and card headings are 500–600; body is 400.
- Mono: JetBrains Mono Variable for source labels, dates, and tabular metrics.
- Body anchor: 16 px with 1.55 line-height.
- UI controls: 14–15 px, never smaller.
- Metadata: 12–13 px only when secondary and still high contrast.
- Landing display: about `2.07rem`, not giant marketing type.
- Product page title: `clamp(22px, 2.4vw, 26px) / 1.15 / -0.02em`.
- Display tracking elsewhere: `-0.025em`.
- Numbers use tabular figures.
- Headings are roman. No gradient display text.

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

- Standard radius: 10 px; large surfaces: 16 px; floating glass: 20–24 px.
- Inputs and buttons: 8–10 px radius.
- Status tags and avatars may be circular.
- Pills are reserved for genuinely compact controls and status, not containers.
- Prefer one containment layer. Nested cards only when interaction requires it.

## Glass (allowed)

Restrained glass is allowed for:

- Global search / command palette
- Ask Nett and person quick-look
- Provenance and evidence overlays
- Import progress and transient controls
- Landing navigation
- People evidence-packet flap (6 px blur on the folder face in a person peek)

Glass rules:

- `backdrop-filter` blur ≤ 28 px; opacity high enough to keep text ≥ WCAG AA
- No busy multi-layer rainbow refraction
- No neon glow rings
- Prefer graphite / paper / brand-purple tints over generic lavender washes
- Basic navigation, tables, standard fields, rows, ordinary buttons, and
  workbench GlowCards remain paper rather than glass.

## Motion

- `--ease-out`: `cubic-bezier(.22, .8, .24, 1)`
- `--ease-in`: `cubic-bezier(0.7, 0, 0.84, 0)`
- `--ease-in-out`: `cubic-bezier(0.65, 0, 0.35, 1)`
- Micro feedback: 120 ms.
- Menus and small state changes: 220 ms.
- Drawers and dialogs: 300 ms.
- Landing may use Digital Serenity word-roll (Geist), pointer light, click
  ripples, and slow held-thread path drift. Paths may loop quietly; they must
  never delay the Open Nett CTA.
- Crystal intro video is ceremonial (landing close only). Everyday chrome keeps
  the continuous-line monogram with a one-shot stroke draw into the wordmark.
- Reduced motion removes spatial transitions, freezes path drift, hides the
  ceremonial 3D stand-in, swaps video for the static crystal mark, and caps
  fades at 150 ms.
- Ask Nett may use a cursor particle-reveal on the agent surface: unrevealed
  UI is fine graphite dust that merges back into crisp type around a fine
  pointer. Aberration and warp stay low. This is not a full-page animated
  background. Reduced motion, coarse pointers, keyboard-only use, and
  browsers without html-in-canvas stay fully crisp.

## Microinteractions

- Focus is immediate and always visible.
- Success is silent when the result is visible.
- Async failures remain next to the failed action and offer retry.
- Buttons press by one pixel.
- Hover behavior always has a focus and touch equivalent.
- Loading preserves the final layout and uses progress for long native imports.

## CTA voice

- Primary: ink-filled, paper text, short action verb.
- Secondary: paper or subtle glass only when floating above content.
- Tertiary: text action with an underline or icon.
- Labels never wrap.

## Navigation

Primary chrome is a **workspace sidebar**: Ask · Review · People · Sources.
The Ask route remains `/today` for deep-link compatibility. The rail shows
labels, a gliding hover mark, Find (⌘K or `/`), and Remember (⌘M). Review
uses a count when items are unresolved; exact queues live on Review. Import
lives in Sources. Find jumps to a person or command. Remember turns a sentence
into fields on a person, after review. Recording a memory is a written note on
that person’s page — it is not structured.

Home **is** Ask. The page is a local agent: a conversations rail of named
threads that survive reload, a live thinking trace of real retrieval stages, a
cited markdown answer with person objects, and a composer. The composer attaches
people with `@` and retrieval abilities with `/` — those are context chips, not a
second page. Deep links use `/today?thread=`. It does not write. It must not lead with follow-up,
contact-frequency, “going quiet,” or database-completeness metrics. People,
Review, and Sources stay on their own routes. Ask may use a **monochrome
traveling border beam** on the composer, **dotted thinking orbs** on retrieval
stages, and a **silver metal ring** on Ask buttons. These stay graphite, pause
under reduced motion, and must not spread to other workbench routes.

People is search-first. The default surface is a **contact-card grid**: name,
face-substitute, why they matter, and a memory. Click or Enter opens a metadata
peek on that card — relationship, role, place, sources — with hover and focus
tips. A folder control in the peek opens the person page (`/people/:id`), not
the quick-profile drawer. Dense list
(`view=list`) and spreadsheet (`view=sheet`) remain secondary modes. The folder
motif is the dossier affordance, not the grid. Multi-value fields use chip
entry, not comma-typed strings.

Sources uses the same GlowCard primitive in a compact grid: connector name,
permission, last refresh, and the primary pull or connect action on the card.
Workbench GlowCards are paper with a pointer spotlight — not glass. In light
mode they keep a graphite edge and drop shadow, and they drop the outer bloom
so paper does not pick up a muddy halo. `color-scheme` follows the resolved
theme so native controls never mix with the opposite appearance.

The public `/` landing is the Digital Serenity hero (unboxed crystal N, slow
word roll-in, held-thread background paths on a flat black field — no background
gradient wash). Labels are sentence case. A local ceremonial 3D stand-in may sit
beside the hero on wide viewports and is hidden when motion is reduced, the
viewport is narrow, or WebGL is unavailable. Below the fold, `/` continues as a
long-form story: a centered tagline, labelled retrieval examples, FAQ, and a
final Open Nett. `/about` is the same story without the cinematic hero. The
scene file lives in `public/` and is not fetched from a remote host at runtime.

Person pages prioritise identity, why the person matters, recent evidence, and
provenance. A continuous vertical thread may connect timeline evidence. Every
synthesised fact exposes its source count or underlying records.

## Onboarding

Onboarding creates a local owner workspace, not a cloud account. It opens on the
glass net mark, explains where data lives, then guides Apple Contacts, Messages,
and optional imports. Every step can be skipped and revisited in Sources.

## Per-page allowances

- Landing may use full-page grid and path animation, pointer light, click
  ripples, a local ceremonial 3D stand-in beside the hero, an ASCII “nett”
  wordmark in the footer, and a graphite-to-cobalt overscroll stretch at the
  bottom. These effects remain decorative, honour reduced motion, and never
  delay navigation.
- Setup and welcome may use decorative brand enrichment.
- App workbench pages stay content-led; glass is sparse.
- Ask may use a monochrome border beam, thinking orbs on retrieval stages, and
  a silver metal ring on its buttons. Graphite only; no rainbow beam, no
  chromatic metal, no spread to other routes.
- Evidence-heavy views may increase density, but never reduce readable type.
- People spreadsheet view may use denser tabular chrome.

## What pages must share

- Tokens, typography, focus treatment, button hierarchy, and error language.
- App shell geometry and navigation labels.
- Source provenance presentation.
- Loading, empty, error, success, and disabled states.

## What pages may vary

- Grid proportions based on the work.
- Density for evidence, communications, and spreadsheet editing.
- Whether the page uses a side inspector or full profile view.

## Landing-page skills

Elaya `landing-page-design` and `redesign-existing-projects` may be invoked for
`/` and `/about` only. Remap their Design Values onto this file: Nett OKLCH
tokens, docked nav, Geist, no workbench restyle. Do not apply Tailwind hex
palettes, island nav, or hero text gradients.

## Banned

- Generic “AI SaaS” purple-on-white gradient kits and glow-everything chrome.
- Gradient text and animated full-page backgrounds on workbench routes.
- Decorative uppercase eyebrows on every section.
- Equal three-card marketing feature rows as the default layout.
- Type smaller than 12 px or low-contrast helper copy.
- Invented metrics or uncited model output.
- LinkedIn login automation, cookie theft, or access-control bypass.
