---
name: nett-browser-qa
description: "Operate Nett in a real browser, find defects, and repair them. Use before declaring any UI feature complete, and whenever a change touches routing, dialogs, forms, lists, or async state."
version: 1.0.0
---

# Nett browser QA

Reading the diff is not testing. This skill is the gate between "the code looks
right" and "the feature works".

## Completion gate

A UI feature is not done until it has been **run, exercised, visually
inspected, and repaired**. Repaired is part of the gate: finding a defect and
leaving it is not passing.

## Setup

```bash
npm run dev                      # :5173 web, :4174 API
node scripts/measure.mjs <label> # screenshots + overflow across the full grid
npm run test:e2e                 # Playwright, needs dev already running
```

Test in a **clean browser session** — no reused profile, no leftover
localStorage. Prior state hides first-run defects.

## Matrix

Widths: 320, 375, 414, 768, 1024, 1280, 1440.
Colour schemes: light **and** dark.
Input: pointer **and** keyboard-only.

## Workflows to exercise

Initial load · People route · search · URL-backed filters · pagination ·
keyboard navigation through people · opening the drawer · opening a profile ·
editing a common field · full-profile editing · a connector or autofill request ·
natural-language capture · dictation, if the browser exposes it ·
browser back and forward across all of the above.

## Conditions to force

| Condition | How |
| --- | --- |
| Slow request | DevTools throttling, or `page.route` with a delay |
| Failed request | `page.route(..., route => route.abort())` |
| Ollama unavailable | Stop `ollama serve`, or point `NETT_OLLAMA_HOST` at a dead port |
| Permission denied | Deny the microphone in the browser prompt |
| Offline | DevTools offline, or `context.setOffline(true)` |
| Empty dataset | `NETT_DB_PATH=/tmp/empty.db npm run dev` |
| Large dataset | The real `data/nett.db` |
| Long text | A 400-character name and a 4,000-character note |
| Unusual Unicode | `Åsa Þórsdóttir`, `李明`, `Nguyễn Thị Ánh`, `عبد الله`, emoji |
| Repeated actions | Do the same thing five times; check for duplicates and leaks |

## Always check

- **No horizontal overflow.** `documentElement.scrollWidth - clientWidth <= 1`
  at every width. This is the single most frequent regression in this codebase.
- **Modal focus.** Focus moves in, is trapped, and returns to the invoking
  element on close — including on Escape and on backdrop click.
- **Back/forward.** URL state restores. No stale results, no lost scroll.
- **Stale responses.** Type fast, then check that an older response cannot
  overwrite a newer one.
- **Layout stability.** Skeletons occupy the final dimensions.
- **Screenshots.** Actually open them and look. Do not assert from the DOM alone.

## Required evidence

- Screenshot paths for every viewport and mode you changed.
- The list of forced conditions you exercised and what each did.
- Every defect found, and for each: fixed, or explicitly recorded as a known
  limitation with a reason.
