---
name: shape
description: Shape an idea into a decision-ready plan. Frames goal, boundary and edge cases, looks up facts first, then asks 3 to 5 questions per round with a default each until confidence is high. Use when someone says "grill me", brings rough intent, or before a large spec.
---

# /shape

```text
/shape {idea or question}        # free-form, no ticket
/shape {T} [topic]               # against an existing ticket
```

**Reads:** the idea, `hl context {T} --json`, the ticket's spec and plan and their git history, product code and data, `hl search` for past work, official docs, the web · **Writes:** nothing without a ticket; with a ticket, each round's questions, answers and decisions through `hl`, plus the spec or plan section they change

This skill structures requirements and finds risk. It does not cut slices (`/plan`) or review (`/challenge`).

## Steps

0. **Baseline.** With a ticket: `hl context {T} --json`, `git log --oneline -10 -- {ticket folder}` and the latest decision records, so you build on the last round instead of asking settled questions again.
1. **Frame** (Diagnostic frame below). Fill all five parts before the first round; an unknown part becomes a question, not a guess.
2. **Look it up first: facts are our job, decisions are the person's.** Before asking anything, walk the Research order. Run independent lookups in parallel read-only agents, and do not hold back questions that do not depend on them.
3. **Map the design tree.** Every decision branches into the decisions that hang off it. The **frontier** is every decision whose prerequisites are settled.
4. **Ask the frontier in one round** (Round format) at the size's depth (Question depth): normally **3 to 5 questions**, highest value first, each with 2 to 5 options when the choices are knowable and a recommended default grounded in what you found. Fewer than 3 only when the frontier is that small; more than 5: hold the rest for the next round. A question that depends on an open one waits. Then wait for answers (No answer).
5. **Suggest, don't just ask.** Each round, add what the person has not considered: a simpler approach, an existing feature to reuse, a risk, a cheaper first slice, a better outcome for the user. Flag scope that adds cost without value.
6. **Write as you go** (with a ticket). As soon as a round is answered, before the next one:
   - each question: `hl question add {T} "..." --option "..."`, then `hl question answer {Q} "..."` with the answer or the assumed default;
   - a settled requirement: `hl decision add {T} "..." --chosen ... --why ...` plus the spec section it changes (per `/spec` refine rules);
   - a settled design choice: `hl decision add` plus the plan section it changes (a schema change still needs `/plan` Schema approval).
   Say in one line what changed ("decision D-004-sa, BR-3 updated"), not the whole page.
7. **Repeat 3 to 6** until the Confidence gate reads **high** (or **medium** with every leftover listed as an assumption). Each answer reshapes the tree: recompute the frontier and state the confidence at the end of every round.
8. **Confirm and hand off.** Present the shaped plan (Output) and ask the person to confirm a shared understanding. Do not act on it before they confirm.

## Rules

- Never ask the person for something the repo, data or docs can answer. Never decide for them; the recommendation is guidance.
- Label every claim **fact** (with a path or URL) or **inference**. Offer one grounded default, not a menu of equal options.
- Prefer the simplest plan that meets the goal (`AGENTS.md`, Keep solutions simple). Say what extra complexity buys, if you recommend any.
- No code changes while shaping. No secrets, connection strings or production data.
- A blocking question (`--blocking`) must be answered before build.

### Diagnostic frame

| Part | Answer |
|------|--------|
| Goal | One sentence: who benefits, what changes, how we will know it worked |
| Boundary | What we own (repos, data, components) versus what we only call (other systems, jobs, vendors) |
| Actors | Every role or system that touches the flow, from the code, not memory |
| Edge cases | Walk each: empty or over-limit input · duplicate or retried request · two users on the same record · failure mid-transaction · offline or flaky network · wrong role · old data that breaks the new rule |
| Non-goals | At least one explicit "we will not..." |

Every edge case ends as a rule (a `BR-n` later), a non-goal or a question. None stays implicit.

### Confidence gate

| Level | Means | Action |
|-------|-------|--------|
| **high** | Frontier empty · no open blocking question · every edge case placed · every claim a cited fact or a confirmed decision | Hand off |
| **medium** | Only low-priority questions left, each with a default | Hand off; list the defaults as assumptions |
| **low** | An open blocking question, an unplaced edge case, or an uncited fact the plan depends on | Keep asking; never hand off |

### Question depth

Ask only what changes the output. The size decides how hard to push; the facts in hand decide whether to ask at all.

| Size | Rounds | When to skip questions |
|------|--------|------------------------|
| **S** | 0 or 1 round, at most 3 questions | Request and code answer everything: no questions; state at most 3 assumptions and go |
| **M** | 1 or 2 rounds of 3 to 5 | Only what code and data cannot answer; stop at confidence high |
| **L** | Rounds until confidence is high, starting with feasibility and boundary | Never skip: `/shape` runs before the spec draft |

Whatever the size, two things are always asked, never assumed: a **not-feasible or trade-off verdict** (analyst) and **schema approval** for any schema change (planner, `/plan` Schema approval).

### No answer

When the person is away (an autonomous run) or skips a question: apply the recommended default, mark it **assumed** and keep going: `hl question answer {Q} "assumed: {default}, {why}"`. A blocking question is never assumed: `hl ticket block {T} --by "{who decides}" --next "answer {Q}"` and continue on branches that do not depend on it.

### Research order

1. **Ticket artifacts:** the ticket folder, including `source/`.
2. **Rules:** the owning project's `CLAUDE.md`, then its skills (`hl skill find`).
3. **Code and data:** call sites and existing patterns; similar past work (`hl search`).
4. **Official docs** for the frameworks and services involved: cite URLs and versions; never memory or forums.
5. **Web:** vendor docs, release notes, advisories. Forums never outrank the repo or official docs.

### Round format

```
Q1. {title}: {question; context in a sentence or two}
    1. {option}   2. {option}   3. Other
    Recommend: {option}, because {why, citing what you found}

Consider: {an alternative, risk or simplification they did not raise}

Confidence: {high|medium|low}, {what keeps it from high}
```

In interactive chat a question tool may carry up to 4 questions per round, with the recommended option first; a fifth goes in the reply text.

## Output

The shaped plan, in chat: the diagnostic frame (table) · decisions made (decision · choice · why · answered or assumed) · what was rejected and why · edge cases and risks, each placed · the smallest first slice · facts and their sources · the confidence level.

No ticket: the shaped plan stays in chat (no files before a real id). Next, whichever fits: no ticket, `/ticket-draft`; not sized, `/spec {T} triage`; no spec, `/spec {T} draft`; spec exists, `/spec {T} refine`; frozen, the planner.
