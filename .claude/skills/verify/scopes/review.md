# /verify: review scope

Structured code review of the changed surfaces, severity-graded. Scope the diff with `git diff {base}...HEAD --name-only` in the owning project (base from its `CLAUDE.md`).

Naming, style, layers and dependency rules come from the project layer (its `CLAUDE.md` and skills). Below are review-only checks that apply to any stack.

**Fresh eyes.** Review in an agent that did not write the code; read the diff and the code around each hunk from disk, and ignore any reasoning handed in. Assume it has bugs.

**Detect the stack first** and state it in the report (language, framework, runtime version), so the project's own rules can be applied.

## Universal

- Errors are handled where they can be handled and surfaced otherwise; no swallowed exceptions.
- Inputs validated at the boundary; nullable values checked before use.
- Async work awaited or joined; cancellation passed through long operations; no blocking calls on a UI thread.
- Functions and classes of reasonable size (flag above about 300 lines); magic numbers and strings become constants or config.
- One responsibility per unit: data access, business logic and notification not mixed in one class; dependencies injected, not constructed inside business logic.
- No repeated enumeration or queries inside loops over large collections.

## Security

- Validate all input at the boundary; never trust client payloads.
- Authorisation enforced in the same layer as for similar endpoints or commands.
- Parameterised queries only; no string-built queries, shell commands or HTML from input.
- No secrets, tokens or connection strings in code or logs; config per environment.
- Log security-relevant failures without leaking personal data or tokens.
- Least privilege and deny by default.

## Performance

- Async I/O end to end; no sync-over-async.
- Pagination for large lists; no N+1 calls; batch or project queries in hot paths.
- Cache only with a clear lifetime and invalidation, using the cache the project already has.
- UI: virtualised long lists, no heavy work on the UI thread, assets sized to fit.
- Data: indexed predicates, no unbounded `SELECT *` in hot paths, set-based operations over row-by-row loops.

## Data and migration scripts

- Repeatable when possible, guarded the way the project's migrations already are.
- Never destructive without explicit ticket scope plus backup and rollback notes.

## Leftovers from AI-written code

- Comments that narrate what the next line does, instead of why.
- `try`/`catch` with nothing to handle: swallowed, logged and rethrown unchanged, or around code that cannot throw.
- Casts, non-null assertions or warning suppressions added only to silence the compiler.
- Dead code: unused functions, parameters, imports, commented-out blocks.
- A second way to do something the repo already does (another mapper, another date helper).
- Hand-written retry or sleep loops where the repo has a policy or none is needed.
- Tests that would still pass if the change were reverted.

## Severity and verdict

Number every finding `1.`, `2.` across the whole report so the person can say "fix 2 and 5". Each has file and line, severity, what is wrong, why it matters and a suggested fix:

| Level | Criteria |
|-------|----------|
| Critical | security hole, data corruption risk, crash or deadlock |
| High | logic error, broken architecture boundary, serious performance issue |
| Medium | maintainability, pattern violation, missing error handling |
| Low | style, naming, minor deviation |
| Info | suggestion or refactor opportunity |

End every review with counts per severity, the top 3 fixes first, and **Pass**, **Needs Work** or **Fail**.
