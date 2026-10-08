# /verify: unit scope

Isolated logic with test doubles, validating acceptance criteria. Verify against the `TC-U-*` cases (and unit-level `TC-N`, `TC-B`, `TC-X`) from the test-case artifact.

- **Home and framework:** the project's existing unit test project and conventions, from its `CLAUDE.md` and test skill. Extend what exists; no new test project without sign-off.
- **Shape:** arrange, act, assert; one logical behaviour per test; names follow the project's convention (default `{Method}_{Scenario}_{Expected}`).
- **Doubles:** replace dependencies at boundaries only; avoid static singletons unless the codebase already wraps them.
- **Coverage:** new risky logic (permissions, money, stock, state transitions) gets tests in the same change when feasible. Do not chase a coverage number; report the figure you measured.
- Every PASS shows the command and its output.
