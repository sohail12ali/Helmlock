---
name: ticket-draft
description: Turn rough intent, a bug report or meeting notes into a ticket draft in chat, then create the ticket with hl ticket new and seed its spec when asked. Use when new work starts and no ticket exists yet; never invents a ticket id.
---

# /ticket-draft

```text
/ticket-draft {rough intent | bug report | meeting notes}
/ticket-draft create            # create the ticket from the draft in context
```

**Reads:** the person's request, investigation notes, `hl config show` (projects) · **Writes:** nothing in Draft (chat only); in Create, the ticket (`hl ticket new`), `{T}-spec.md` and open questions (`hl question add`)

## Steps

1. Pick the phase:

   | Phase | Trigger | Output |
   |-------|---------|--------|
   | **Draft** | the person asks for a ticket write-up; no ticket yet | **chat only**: the draft in the Output order; no files |
   | **Create** | the person asks to **create, file or open** it | `hl ticket new`, then seed the spec: read [persist.md](persist.md) |

   Draft-only intent stays in Draft. Create intent runs Draft and Create in the same turn.
2. **Before drafting:** an unknown type, priority, size or project: infer a default and show it in Ticket details as *inferred*, or ask one tight question (with a recommendation) when the choice changes the draft materially. List assumptions under *Assumptions*, apart from stated facts.
3. **Draft** in the Output order.
4. **Create:** pick the project id from `hl config show` (ask if several fit), then:

   ```
   hl ticket new "{short title}" --project {id} --size {S|M|L} --priority {priority} --goal "{summary line}"
   ```

   It returns the id (`T-014-sa`) and writes `ticket.toml` at stage `backlog`. Then follow [persist.md](persist.md) to seed `{T}-spec.md` and the open questions.

## Rules

- No files before `hl ticket new` returns a real id. Never guess, pre-create or increment an id.
- A stakeholder request in the prompt **is** the requirement: draft from it even if informal or cut short; infer the rest and mark assumptions. Never reply "requirements needed" or leave the description empty.
- Never invent parent tickets, versions or assignees.
- Creating the ticket is a write: do it only when the person asked to create it.

## Output

Paste-ready markdown with `##` and `###` headings and bullets, in this order:

1. **Short title** (1 to 4 words): a label for boards and filters, for example `Export retry`, `Login timeout`.
2. **Ticket details:** fill from input; else infer and mark *inferred*, or `TBD` when no reasonable default exists. Omit rows that do not apply.

   | Field | Value |
   |-------|-------|
   | Project | a project id from `hl config show`, or `TBD` |
   | Type | Story, Bug, Task or Spike *inferred* |
   | Priority | High, Medium or Low *inferred* |
   | Size | S, M or L *inferred, rough* |
   | Severity (bugs) | S1 to S4, or omit |
   | Parent or related | ticket ids, or `None` |
   | Environment | Production, staging, development or all *inferred* |
   | Stakeholders | names, or `Unknown, confirm` |
   | Target date | date or `TBD` |

3. **Summary line:** one line, outcome-oriented, about 120 characters at most. Good: `Retry failed exports once before alerting`. Weak: `Fix stuff`.
4. **Description**, sections a to d always:
   - **a. Summary**: 2 to 4 sentences: who is affected, what is wrong or missing, why it matters.
   - **b. Description**: current behaviour or gap; desired end state; numbered steps to reproduce (bug) or user flow (feature); data and preconditions (no real personal data).
   - **c. Background**: the source of the ask, or "None provided"; related decisions and constraints.
   - **d. Scope**: **In scope** (concrete deliverables) · **Projects** (from the request, else *Unknown, confirm*; never invent).
5. **Optional sections** (omit the heading when not needed): related tickets · user stories (`As a ... I want ... so that ...`) · inputs and outputs · behaviour (rules, edge cases, errors) · acceptance criteria (numbered, testable, optional Given/When/Then) · technical notes · out of scope.
6. **Assumptions:** a short list.
7. **Next steps** (always): Draft: reply **create it** to run `hl ticket new`, or edit the draft first. After Create: `/spec {T} triage`, or `/kickoff {T}`.
