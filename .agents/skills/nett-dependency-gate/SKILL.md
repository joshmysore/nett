---
name: nett-dependency-gate
description: "Prevent package, abstraction, and architecture bloat in Nett. Use before adding any npm dependency, before introducing a new abstraction layer, and when a change starts to look like a framework."
version: 1.0.0
---

# Nett dependency gate

Nett is a local single-user app. Its complexity budget is small and already
partly spent. Every addition has to earn its place.

## Seven questions

Answer all seven, in writing, before `npm install`.

1. **Is the capability already present?** Check `package.json` first. Nett
   already has `date-fns`, `zod`, `fuse.js`, `clsx`, `tailwind-merge`,
   `libphonenumber-js`, `csv-parse`, `xlsx`, `fflate`, `motion`, and
   `@phosphor-icons/react`.
2. **Is it in the platform or an existing framework?** `Intl`, `URL`,
   `URLSearchParams`, `AbortController`, `crypto.randomUUID`, `structuredClone`,
   `Intl.Collator`, CSS `:has()`, container queries, `<dialog>`, and SQLite's own
   FTS5, JSON1, and window functions cover more than people assume.
3. **Can it be written clearly in a small amount of code?** If the answer is
   "about forty lines", write the forty lines. You will own them either way.
4. **What does it add to the client bundle?** Measure with `npm run build`, not
   with a bundlephobia guess. Server-only dependencies cost nothing here — say
   which side it lands on.
5. **Does it introduce a competing paradigm?** A second router, a second data
   layer, a second styling system, or a second state model is a hard no. Nett
   has one of each.
6. **Is it needed in more than one place?** One call site is not a dependency,
   it is a function.
7. **What maintenance burden does it add?** Native builds, peer-dependency
   constraints, codegen steps, and anything that pins the Node or Electron
   version are expensive out of proportion to their size.

## Automatic rejections

- An abstraction with exactly one caller.
- Global state for state that belongs to one route.
- A generic factory, registry, or plugin system with one implementation.
- A second design-system or component layer.
- Speculative extensibility for a requirement nobody has stated.
- A package for a trivial utility — date formatting, deep equality, `classnames`,
  uuid, debounce, or query-string parsing.
- Client-side computation of something the database should answer. If it is a
  count, a group, a filter, or a sort over many rows, it belongs in SQL.
- A state-management or data-fetching framework without a measurement showing
  the current approach fails.

## If it passes

Record in the PR description: the package, the side it runs on, the measured
bundle delta, the call sites, and which of the seven questions was decisive.

Pin a real version. Never invent one — install it and let the package manager
write the number.
