---
name: spec
description: Owns a ticket's living spec (the what and why). Triages size S, M or L, documents today's behaviour and feasibility, drafts rules and Given/When/Then criteria, refines on feedback and freezes on a checklist. Use when sizing, writing, changing or freezing a ticket's requirements.
---

# /spec

```text
/spec {T} [mode]                               # mode = triage | draft | refine | freeze
/spec {T} refine "{feedback or answers, word for word}"
```

**Reads:** `hl context {T} --json`, `{T}-spec.md`, `hl blockers {T}`, product code and data definitions, prior tickets (`hl search`) · **Writes:** `{T}-spec.md`; decisions, questions and gaps through `hl`; the stage move at freeze

## Steps

Paths are relative to the ticket folder (`hl context {T} --json` lists it). Read [techniques.md](techniques.md) before `draft` or `refine`.

1. Pick the mode:

   | Mode | Does | Writes |
   |------|------|--------|
   | `triage` | Size the ticket S, M or L (Size below) | one decision record |
   | `draft` | Ground in code, data and past work; example-map the ask into `BR-n` and `AC-n` | `{T}-spec.md` from [templates/spec.md](templates/spec.md) |
   | `refine` | Apply feedback, answers or challenge findings; the only mode that changes scope | `{T}-spec.md` in place, one decision per decision |
   | `freeze` | Run the freeze checklist; all pass: freeze | the move to `plan` |

   **No mode:** the next one needed. No size: `triage`. No spec, or only the template: `draft`. Unapplied answers, feedback or open findings: `refine`. M or L never challenged: `/challenge {T} spec`. Else `freeze`. Already in `plan` or later: report frozen.
2. **triage:** read the request, the ticket's project and a quick code and data scan; pick the size (Size below). Record it: `hl decision add {T} "Size {S|M|L}" --chosen {size} --why "{repos, layers, schema, unknowns}"`. The ticket's size field is set by `hl ticket new --size`; if it is missing or differs, say so in the report for the person to fix (never edit `ticket.toml`). L: recommend `/shape {T}` before `draft`.
3. **draft:** no spec: render the template (`{T}`, `{TIMESTAMP}`). Never overwrite a spec that holds more than the template; switch to `refine`. First draft: `hl ticket move {T} spec`.
   1. Keep the request word for word under **Original request**; write **Summary** (one paragraph).
   2. Ground yourself; facts are our job. Read the owning project's code (one entry point per layer), its data definitions, `hl search` for prior tickets and investigations in the area. Cite each in **Sources**.
   3. Fill **Current state and feasibility** from what you read: today's flow, today's status values with meanings, constraints and a verdict. Not feasible, or feasible only with a trade-off: raise it with the person before writing rules.
   4. Example-map the ask: rule, concrete examples, then `BR-n` and `AC-n` (Given/When/Then). Group ACs under `US-n` only when there are several actors or flows.
   5. Fill **Scope and non-goals** and **Data touched** (existing data, cited; unverifiable: `UNVERIFIED` plus a gap; new data written as a need, never as fields or schema: that is `/plan {T} design`). Ask per `/shape` question depth. Each answered or assumed point: `hl question add` then `hl question answer`. Each missing fact: `hl gap add {T} "..." --category {category}`.
   6. S: a short spec (Summary, Business rules, Acceptance criteria, Non-goals, Original request), then straight to `freeze`.
4. **refine:** record the feedback word for word in the decision's `--why`; edit the affected sections in place; answer questions with `hl question answer`; new unknowns become new questions. A scope or rule change after freeze: `hl ticket move {T} spec` first and say so.
5. **freeze:** run the freeze checklist; stop at the first failure and report the item, a pointer and the next command. All pass: `hl decision add {T} "Spec frozen" --chosen frozen --why "freeze checklist passed"`, then `hl ticket move {T} plan`. Exit 2: the gate names what is still open; fix it and run freeze again.

## Rules

- **Ground, never invent.** Every data structure, field, component, file or behaviour cites a definition file, a code path, a commit or a ticket. Uncited: mark `UNVERIFIED` and add a gap; never guess a field.
- **One spec, edited in place.** No version files, iteration logs or summaries; history is git plus decision records. Only `refine` changes scope, and every scope change is a decision record.
- **State through `hl`:** questions, gaps and decisions are records, and the spec points to them (Open questions is a pointer, not a copy). Never edit `ticket.toml`; never write `status:`, `stage:` or `phase:` frontmatter.
- **Stakeholder wording carries weight:** Original request is never edited; a changed intent is a decision record.
- **No design in the spec:** no schema, field names, types or component lists. A person's suggested design is recorded as input for the planner (a decision or a question), not as a rule.

### Size

| Size | Signals | Path |
|------|---------|------|
| **S** | 1 repo, one layer, no schema change, clear ask, at most 1 day | short spec, freeze in one sitting; no challenge |
| **M** | 1 or 2 repos, a schema touch or 2+ layers | draft, refine, `/challenge {T} spec`, freeze |
| **L** | several repos, new data structures, external integration, real unknowns | `/shape {T}`, draft, `/challenge {T} spec` (with pre-mortem), refine, freeze |

Any one signal of a bigger size wins. Too big even for L: split (techniques.md, Splitting).

### Freeze checklist

1. Summary is one paragraph; Original request present and unedited.
2. Every `BR-n` has at least one `AC-n`; every `AC-n` traces to a BR or is stated as standalone behaviour.
3. Every AC is Given/When/Then, testable (an observable outcome, no vague words: techniques.md, AC smells) and covers one behaviour.
4. Scope and non-goals has at least one explicit non-goal.
5. Data touched: every existing structure cited; nothing `UNVERIFIED` unless deferred with a decision record. New data is a need, with no schema. Current state and feasibility has a verdict with evidence; "not feasible" never freezes.
6. No unresolved `⚠` markers (resolved, or `⚠ accepted: {why}` with a decision record).
7. `hl blockers {T}` exits 0.
8. M and L: `/challenge {T} spec` has run in a fresh agent and left no open critical finding.

## Output

The report shape in `AGENTS.md`: mode, size, BR and AC counts, questions and gaps opened, the freeze result (pass, or the first failure with a pointer). Next: after `triage`, `/shape {T}` (L) or `/spec {T} draft`; after `draft` or `refine`, `/challenge {T} spec` (M and L) or `/spec {T} freeze`; frozen: the planner.
