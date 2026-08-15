# Jobs distinction — Find / Remember / Record / Ask

Screens in `docs/audits/jobs-distinction-screens/`. Verified against the
locked jobs: Find retrieves, Remember structures fields for review, Record
keeps a verbatim note on a person, Ask does not write.

## Remember (⌘M)

- `remember-light-1440.png`, `remember-dark-1440.png`, `remember-light-375.png`,
  `remember-dark-375.png`, `remember-from-profile.png`
- Composer heading is **Remember this**.
- Primary action is **Structure into fields**. Nothing writes until review.
- Review screen lists proposed fields with accept / edit / reject.
- Opening Remember from a profile still structures; it does not dump a free
  note onto the person.

## Record

- `record-dark-1440.png`
- Person page action is **Record a memory**.
- The field is a verbatim note attached to that person. There is no
  “structure into fields” control on this rail.

## Home / Ask

- `home-light-1440.png`, `home-dark-1440.png`, `home-light-375.png`,
  `home-dark-375.png`
- Home copy asks what is worth remembering now. Ask sits on Home and states
  that it does not write.
- Recently resurfaced people come from indexed evidence, not CRM scores.
- A cited snippet (“From the record”) is a stored excerpt, not a generated
  briefing.

## What must stay distinct

| Job | Writes? | Structures fields? |
| --- | --- | --- |
| Find (⌘K) | No | No |
| Ask | No | No |
| Remember (⌘M) | Only after review | Yes |
| Record | Yes, verbatim on that person | No |
