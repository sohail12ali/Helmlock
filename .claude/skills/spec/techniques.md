# /spec: techniques

Read before `draft` or `refine`. Parent: [SKILL.md](SKILL.md).

## Example mapping

Turns an ask into rules and criteria without inventing either.

1. **Story:** restate the ask in one line (who, what, why). That line seeds the Summary.
2. **Rules:** list every rule the ask implies: thresholds, ordering, state transitions, permissions, what happens on failure. Each becomes `BR-n`, one atomic sentence.
3. **Examples:** for each rule, 1 to 3 concrete examples with real-looking data (an order, a quantity, a role; no real personal data): the happy case, the boundary, the rejection. Write them under **Examples** as `BR-n -> example -> expected outcome`.
4. **Criteria:** each example that shows distinct behaviour becomes an `AC-n` in Given/When/Then. Examples that repeat a behaviour stay as examples only.
5. **Questions:** an example nobody can predict the outcome of is an open question: `hl question add {T} "..."`. Do not guess the answer into an AC.

A rule with no example is untested; a rule with too many examples is probably two rules, so split it.

## Writing non-goals

- Name what a reader could reasonably expect to be included and is not: adjacent screens, other channels, reports, backfill of old data, admin UI.
- One line each with the reason: `No backfill of existing records; new records only (D-004-sa).`
- "Future work" is a valid reason; link the follow-up ticket if one exists.
- Never leave the section empty: freeze fails.

## AC smells

| Smell | Example | Fix |
|-------|---------|-----|
| Vague words | "quickly", "easily", "user-friendly", "etc.", "appropriate", "as needed" | Replace with a number, a role, a message text or a list |
| Several behaviours | "Then the order is saved and the stock is released and an email is sent" | One AC per observable outcome |
| UI-coupled wording | "When the user clicks the blue Save button" | Describe the action: "When the clerk confirms the order"; UI detail belongs in the plan |
| Implementation leak | "Then the service updates column Y" | State the observable outcome; the data goes in Data touched |
| Untestable Given | "Given the system is working normally" | State the data precondition: "Given order 123 has 2 open lines" |
| Missing negative | Only the happy path | Add the rejection example from example mapping |

## Splitting a ticket that is too big

Split when any holds: more than about 8 BRs, ACs across 3 or more unrelated actors, work spans repos that can ship independently, or one part waits on an external answer.

- Split by **user-visible outcome** (a thin vertical slice that ships alone), not by layer.
- Common seams: read-only view first, then edit; one channel first; happy path first, exceptions next; a data fix apart from the feature.
- Record the split with `hl decision add`; the new part becomes a new ticket through `/ticket-draft` and `hl ticket new`. Never invent its id.

## What becomes a decision record

One `hl decision add {T} "{title}" --chosen "{choice}" --why "{reason}"` per decision that changed or bounded the spec. Add `--rejected "{option}"` for each option turned down.

- The triage size and its reasoning.
- Every scope change, answered question that altered a rule, and accepted `⚠` finding.
- Feedback applied in `refine`: the quote (or its source) in `--why`.
- Deferrals (`UNVERIFIED` data accepted for now), splits, and the freeze itself.

Not a decision: typo fixes, rewording that changes no behaviour, record bookkeeping.
