---
name: nett-feature-review
description: "Independently challenge a completed Nett feature before it is declared done. Use as the final gate on any feature, ideally in a fresh context that did not write the code."
version: 1.0.0
---

# Nett feature review

This is an adversarial pass, not a victory lap. Run it in a **fresh context**
where possible — the agent that wrote the code is the worst judge of whether it
was worth writing.

## Eleven questions

Answer each with evidence, not assertion. "Yes, because the diff shows X" or
"No" — never "should be fine".

1. **Is this merely a category convention?** Would a generic CRM have shipped
   the same thing? If so, what does Nett's owned evidence add that they could
   not?
2. **Did it remove steps?** State the interaction count before and after. If it
   went up, what capability justifies that?
3. **Does it use Nett's owned evidence well?** Or does it ask the user for
   something already sitting in `field_provenance`, `communications`,
   `source_records`, or `memories`?
4. **Does it preserve trust?** Is anything asserted that the stored evidence
   does not support? Is any confidence displayed higher than it deserves?
5. **Does it improve after repeated use?** On the fiftieth use, is it faster, or
   the same, or slower because something accumulated?
6. **Are failures visible and recoverable?** Force the failure. Was it silent?
   Could the user retry, or were they stuck?
7. **Is it integrated or bolted on?** Does it use shared primitives, shared
   tokens, and the existing route and state conventions — or did it bring its
   own?
8. **Is the complexity justified?** Count new files, new abstractions, new
   dependencies. For each, name the second call site. If there isn't one, it is
   premature.
9. **Can any UI or code be removed?** Look specifically for: fields nobody
   fills, states nobody reaches, options nobody changes, and abstractions with
   one implementation.
10. **Are all claims backed by stored evidence?** Every summary, every count,
    every "why this matters" line. Trace one of each back to a row.
11. **Does it remain fast with thousands of records?** Not "should" — was it
    measured against `data/nett.db`? Where is the number?

## Also check

- **Privacy.** Did anything new cross the machine boundary? Is any new provider
  on by default?
- **Provenance.** Can every written field be traced to its source?
- **Migrations.** Append-only, transactional, and safe against an existing
  database with real rows in it?
- **Deep links.** Do existing routes and query parameters still work?
- **Dead experiments.** Is there commented-out code, an unused flag, an
  abandoned component, or a leftover script?

## Output

Three lists, each item concrete and actionable:

- **Blockers** — data loss, privacy regression, broken workflow, serious or
  critical accessibility violation, unsupported product claim, missed budget
  with no explanation. Must be fixed before done.
- **Significant concerns** — real problems that do not block. Fix or record.
- **Optional follow-ups** — worth doing later. Record and move on.

If a review produces no blockers and no concerns, it was probably not adversarial
enough. Look again at questions 1, 8, and 9.
