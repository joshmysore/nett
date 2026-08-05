---
name: nett-accessibility-interaction
description: "Review semantic structure, focus, keyboard behaviour, responsive layout, and reduced motion in Nett. Use when adding or changing any interactive component, dialog, list, or route, and before declaring UI work complete."
version: 1.0.0
---

# Nett accessibility and interaction

Nett is a keyboard tool. Accessibility work here is not compliance theatre — it
is the difference between a fast tool and a slow one.

## Structure

- One `<main>`, one `<h1>` per route, headings that descend without skipping.
- Landmarks: `<nav>`, `<main>`, `<aside>`, `<header>`, each labelled when more
  than one of a kind exists.
- Semantic controls. A `<button>` for an action, an `<a href>` for navigation,
  a real `<input>` with a real `<label>`. Never a `<div>` with `onClick`.
- A list of things is a list. A row of a table is a table row. Do not rebuild
  semantics with ARIA that the element already has.

## Labels and descriptions

- Every input has a programmatic label. Placeholder text is not a label.
- Icon-only controls carry `aria-label`.
- Error text is associated via `aria-describedby` and announced with `role="alert"`.
- Async status uses a polite live region. Errors use assertive.

## Focus

- `:focus-visible` is visible against **both** light and dark surfaces, and
  against every background it can appear on.
- Focus order follows visual order.
- Dialogs trap focus, and restore it to the invoking element on close —
  including on Escape and on backdrop dismissal.
- Opening a route or a drawer moves focus somewhere sensible, not to `<body>`.
- Nothing is reachable only by hover. Every hover affordance has a focus and a
  touch equivalent.

## Keyboard

- The whole app is operable with no pointer.
- Lists support Arrow keys, Home, End, and Enter.
- Escape closes the topmost layer only.
- Shortcuts do not fire while the user is typing in a field, unless the shortcut
  is scoped to that field.
- Every keyboard shortcut has a visible, discoverable equivalent. `Cmd+M` can be
  taken by the OS or another app; the UI must not depend on it alone.

## Responsive

- **No horizontal overflow at 320, 375, 414, or 768 px.** Assert it, do not
  eyeball it:
  ```js
  await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ```
- Touch targets ≥ 44 px on coarse pointers.
- Long unbroken strings — emails, URLs, transliterated names — must wrap or
  truncate, never push the layout.
- Mobile is a designed layout, not a squeezed desktop.

## Contrast and motion

- Body and control text ≥ 4.5:1. Large text and UI boundaries ≥ 3:1. Check in
  both modes; the dark mode usually passes and the light mode usually does not.
- Never encode meaning in colour alone.
- `prefers-reduced-motion: reduce` removes spatial transitions and caps fades at
  150 ms. Content must remain fully reachable with motion off.

## Verification

```bash
npm run test:e2e            # includes axe via @axe-core/playwright
node scripts/measure.mjs x  # overflow across the full viewport grid
```

Automated checks are necessary and not sufficient. **Manually tab through the
feature** in both modes. axe cannot tell you that focus order is nonsense or
that Escape closed the wrong layer.

## Acceptance criteria

- No serious or critical axe violations in the tested flows.
- Manual keyboard pass completed and recorded.
- Zero horizontal overflow at all four narrow widths.
- Focus visible, trapped, and restored in every dialog.
- Reduced motion honoured.
