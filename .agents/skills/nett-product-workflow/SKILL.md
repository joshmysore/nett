---
name: nett-product-workflow
description: "Design a Nett feature around recognition, retrieval, safe capture, and relationship follow-through instead of a CRUD screen. Use before implementing any user-facing Nett feature, when a request arrives as 'add a page/form/field for X', or when a feature is drifting toward a long form."
version: 1.0.0
---

# Nett product workflow

Nett fails when a feature is shaped like a database table. This skill forces the
shape to come from the user's job instead.

## When this runs

Before writing UI or API code for any user-facing feature. Also run it when you
notice yourself building: a form with more than six fields, a settings page for
one toggle, a "manage X" screen, or a list that shows every column it has.

## Workflow

Work through these in order and write the answers down in the PR description or
the task notes. Steps 6 and 7 are the ones that change outcomes; do not skip
them because the first idea seemed fine.

1. **User job.** One sentence, in the user's words, starting with a verb.
   "Remember why I should talk to Ana before Thursday", not "manage memories".
2. **Trigger.** What is true in the world the instant the user needs this? Are
   they at a laptop, mid-conversation, reviewing, or searching? This determines
   whether the entry point is a route, a shortcut, or an inline affordance.
3. **Shortest successful path.** Count the interactions from trigger to done.
   Write the count. You will compare against it at the end.
4. **What Nett can infer from owned evidence.** Enumerate the specific tables
   and connectors that already hold the answer: `field_provenance`,
   `communications`, `memories`, `source_records`, `imported_rows`. Anything not
   on this list is not inferable and must be asked for or left blank.
5. **What requires explicit confirmation.** Anything that writes a structured
   field, links an identity, or asserts a fact about a person. Default to
   confirmation whenever the cost of being wrong is a corrupted profile.
6. **Three approaches.** Write all three, briefly.
   - *Conservative*: minimum change, maximum reversibility.
   - *Lowest-friction*: fewest interactions, most inference.
   - *Differentiated*: uses evidence Nett owns that a generic CRM could not.
7. **Reject two mediocre implementations, in writing.** Name the obvious ones
   and say why they lose. The usual suspects: "add a modal form", "add a column
   to the table", "add a settings toggle", "add an AI panel".
8. **States.** Define first-use, normal, empty, loading, failure, conflict, and
   recovery. A state you did not define will be built badly.
9. **Keyboard and power-user behaviour.** What happens with no mouse? What does
   a user doing this fifty times want that a first-timer does not?
10. **Choose one and justify it** against the job in step 1 and the count in
    step 3.

## Required evidence

- The ten answers above, recorded.
- Interaction count before and after.
- The list of fields the feature writes, each marked *inferred* or *confirmed*.

## Acceptance criteria

- Interaction count went down, or stayed flat while capability went up.
- No long form on the routine path. Long forms are acceptable only as an
  explicitly-chosen "edit everything" escape hatch.
- No invented certainty. A value Nett is unsure about is shown as unsure.
- Structured writes are reviewed before they land.
- The feature behaves coherently on the fiftieth use, not just the first.
- Provenance is preserved for everything written.

## Anti-patterns

| Smell | What it usually means |
| --- | --- |
| "Add a page for X" | X is a property of an existing object, not a place |
| Every field editable at once | The job was never identified |
| A toggle in settings | The decision should be inferable or contextual |
| An empty state that says "No data" | The empty state is the first-use state and was skipped |
| A confirmation dialog | Either make it reversible, or make it reviewable before it happens |
