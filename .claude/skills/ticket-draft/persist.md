# ticket-draft: seed the new ticket

Read when `hl ticket new` has returned a real id and the draft should become ticket files. Parent: [SKILL.md](SKILL.md).

`hl ticket new` writes `ticket.toml` and nothing else (folders are created lazily). This step adds the spec and the open questions; it never edits `ticket.toml`.

## Spec

Render `.claude/skills/spec/templates/spec.md` into the ticket folder as `{T}-spec.md` (`hl context {T} --json` lists the folder), replacing `{T}` and `{TIMESTAMP}`, then map the draft:

| Draft section | `{T}-spec.md` section |
|---------------|-----------------------|
| Summary line plus a. Summary | **Summary** (stakeholder line plus paragraph) |
| b. Description, c. Background | **Problem and users** |
| d. Scope plus Out of scope | **Scope and non-goals** |
| Behaviour | **Business rules** (`BR-n`) |
| User stories plus acceptance criteria | **Acceptance criteria** (`AC-n`, Given/When/Then) |
| Inputs and outputs | **Data touched**, marked `UNVERIFIED` until `/spec {T} draft` cites it |
| Technical notes, related tickets | **Sources** |
| The person's raw request | **Original request**, word for word |

Ticket details (type, priority, size, project) live in `ticket.toml` through `hl ticket new`, not in the spec.

## Open questions

One question per assumption that changes the output:

```
hl question add {T} "{assumption as a question}" --option "{default}" --option "{alternative}"
```

Add `--blocking` only when the answer must come before the spec can freeze.

## Idempotency

- A spec that already holds more than the template: merge into empty sections only; never overwrite.
- The ticket already past `spec`: ask before changing the spec; changes go through `/spec {T} refine`.
- After seeding, list the files written and suggest `/spec {T} triage`.
