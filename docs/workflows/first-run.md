# First-run owner context

The job is to get a usable graph without filling a spreadsheet of metadata.

## Product answers

1. **User job.** Get my people into Nett with hometowns, interests, and who-knows-whom filled from conversations I already have, after telling Nett a couple of my own hometowns and interests.
2. **Trigger.** First launch on a Mac that already has Messages, WhatsApp, or Gmail.
3. **Shortest successful path.** Name → speak or type two hometowns and two interests → import or skip Contacts → connect any conversation source → open People. Interaction count: about 6 on the speak path, versus ~15 when Gmail/WhatsApp lived only on Sources and every field was typed per person.
4. **Inferable from owned evidence.** Identities from Apple Contacts; conversation records from Messages, WhatsApp, Gmail; last contact from communications; mutuals from overlapping school/place/reciprocal edges; hometown from neighbors who already share an owner hometown. Not inferable: Instagram’s graph. Nett does not log in to Instagram or scrape mutuals.
5. **Requires confirmation.** Owner chips on Continue (the user’s own facts). Every structured field on another person. Identity links. Conversation sync is import of source records, not a silent metadata write.
6. **Three approaches.**
   - Conservative: add two chip fields to Welcome and link out to Sources.
   - Lowest-friction: a You step with speak-or-type, then one Conversations step for Messages, WhatsApp, and Gmail.
   - Differentiated: treat owner hometowns as an Instagram-style cluster prior over the user’s own graph.
7. **Rejected.** Instagram login or mutuals scraping (privacy, ToS, AGENTS.md). A long owner profile form. Auto-writing metadata after sync. A video pipeline when dictation and chips already cover “film a couple hometowns.”
8. **States.** First-use: Open Nett to Ask. Sources connect independently. Empty: Open Nett with zero sources. Loading: dictation, preview, or import in progress. Failure: mic denied or source unread — type or skip. Conflict: person-field suggestions still show old vs new in review. Recovery: People Fill gaps for hometowns and interests. `/setup` redirects to Ask.
9. **Keyboard.** Tab through chips; Enter/comma commits; Skip and Continue are buttons; recording is optional and disclosed.
10. **Chosen.** Lowest-friction setup plus owner hometowns as a cluster prior. Autofill stays reviewable. Fill gaps remains the easy typed path, now with owner interests as typeahead when filling interests.

## What “who would know each other” means here

Instagram mutuals work because the product already knows you and your graph. Nett already stores place, school, company, and mutuals. The missing seed was the owner. Two people who share a school and a place that is also one of *your* hometowns are a stronger, explainable suggestion. Two people who only share a large city you named are not assumed to know each other.

## Verification

- Unit: `server/capture/__tests__/owner-context.test.ts`, `server/setup/__tests__/onboarding.test.ts`, owner cases in `server/intelligence/__tests__/shared-context.test.ts`.
- E2E: `e2e/setup-workflow.spec.ts` (`/setup` redirects to Ask; owner-preview API).
