---
name: challenge
description: Fresh-eyes adversarial critique of a ticket's spec, plan or implementation through five lenses (security, architecture, resilience, maintainability, lean), plus gaps and overlap. Use when red-teaming a spec, reviewing a plan before build, or checking code for plan drift.
---

# /challenge

```text
/challenge {T} [stage]                  # stage = spec | plan | implementation | all
/challenge {T} implementation [slice]   # for example S1
/challenge audit {project or path}      # no ticket: the lean lens over a whole repo, chat only
```

**Reads:** the stage inputs (table below), `hl context {T} --json` · **Writes:** findings through `hl gap add`, `hl question add` and `hl bug add`; `⚠` markers in the spec (spec stage only)

## Steps

1. Pick the stage. No stage given: read the ticket's stage from `hl context {T} --json`:

   | Ticket stage | Challenge stage |
   |--------------|-----------------|
   | `spec` | `spec` |
   | `plan` | `plan` |
   | `build`, `verify` | `implementation` |
   | anything else | ASK once |

   `all` runs the applicable stages in order, skipping any whose inputs are absent. `audit` takes no ticket and follows [stages/audit.md](stages/audit.md) only.
2. Read [rules.md](rules.md) (how findings are recorded, severity, kinds, shared acceptance criteria), then only the stage file being run:

   | Stage | Inputs read | Output |
   |-------|-------------|--------|
   | [spec](stages/spec.md): gaps, overlap, red-team, pre-mortem (L) | `{T}-spec.md`, open records, the codebase and prior tickets | `⚠` markers in the spec, gap and question records |
   | [plan](stages/plan.md) | `{T}-spec.md`, `{T}-plan.md`, tasks (`hl ticket show {T} --json`), `hl validate {T}` | gap and question records; the build gate |
   | [implementation](stages/implementation.md) | `{T}-plan.md`, the slice's tasks, `test-cases/`, the branch diff | gap, question and bug records |

3. Report every lens, then the gate: `clear` or `blocked: {n} critical`.

## Rules

- **Find, don't fix.** Every stage records findings only; repair happens in the commands named in rules.md (Core principle).
- **Fresh eyes.** Run in an agent that did not draft the artifact under review; the author's context biases the review. Read the artifacts from disk; ignore any reasoning handed in.
- **Five lenses every pass:** security, architecture, resilience, maintainability, lean (rules.md, Review lenses). A pass that does not report all five is incomplete.
- Findings live in records written through `hl`, never in hand-edited TOML and never in a parallel prose file.
- S tickets skip the spec and plan stages; the implementation stage runs for every size.

## Output

The report shape in `AGENTS.md` (stage or slice in the `STATUS:` line), plus a lens table `Lens · Critical · Major · Minor · Top finding` (one row per lens, `clear` when none), then the gate. Next: the stage's repair command from rules.md for any open finding.
