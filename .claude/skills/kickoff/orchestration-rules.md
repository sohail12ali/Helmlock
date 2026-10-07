# Orchestration rules

**Scope:** agent mechanics: how far a hand-off may travel, when one task is too big for one agent, how a failed test gets back to a builder. Splitting a **goal** into distinct tasks and running them in waves is a different question, owned by `.claude/skills/do/dispatch-reference.md` (Orchestration), used by `/do` and `/kickoff`. In kickoff a wave never spans a stage boundary. A task may be spawned after it is decomposed; a spawned child never decomposes.

## 1. Hand-off

**When:** fixable without product or architecture policy. Design or scope judgment goes to the person.

| Situation | Delegate |
|-----------|----------|
| Requirement ambiguity | the person (through the analyst) |
| Test failures that are not architectural | builder |
| A bounded performance regression | fixer |
| A broken artifact link or layout error from `hl validate` | fixer |

Pass full context (ticket, paths, logs). The handler owns the artifact updates. **Depth at most 2.** About 5 minutes of surgical scope.

**Context running out?** Say so in a `STATUS: needs an answer` report and suggest a fresh session (with `hl context {T}` as the starting point) under Next. A hand-off is only for passing work between agents inside one run.

## 2. Spawn

Two independent triggers; either one is enough:

| Trigger | Split by | Child scope |
|---------|----------|-------------|
| **2 or more projects** touched | **project** | one project root, its own `CLAUDE.md`, its own ticket branch, its own build |
| **12 or more files** across **3 or more layers** (for example data, API, UI) **in one project** | **layer** | one layer each |

Below both: no spawn.

**Project split beats layer split.** Fan out per project first; a project that also clears the 12-file, 3-layer bar may split by layer *inside* its child. Never split one project across two children.

Launch every child in a **single message** so they run in parallel. Sequence instead of fanning out only when project B cannot compile until project A ships a contract; settle that contract in the parent first.

The parent merges, checks the cross-layer **and cross-project** contract, and owns the shared contract (API shape, data structures, config keys).

## 3. Verifier to builder loop

The verifier classifies failures. **Fixable**: hand off to the builder, patch, retest. **Blocker** (spec conflict, wrong architecture): the person.

Under wave orchestration a fixable failure becomes a **new task in the current stage**, not a stage rollback; the ticket does not move backwards for a retest.

| Failure | Fixable? |
|---------|----------|
| Assertion mismatch, typo, missing null guard | yes |
| Artifact metadata or link | yes (fixer) |
| Architecture or requirement contradiction | no |

## 4. Closure to publish

`/close {T}` success: the person may hand publishing to the deployer. It is never automatic, and every publish asks first. Closure is idempotent and a prerequisite for publishing.

## 5. Reporting

Report shape: `AGENTS.md`. A hand-off or fan-out that changed the outcome adds one line: `Hand-off: {reason} - {result}` or `Merged: {n} projects - conflicts: {n} - {what landed}`.
