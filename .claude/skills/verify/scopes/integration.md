# /verify: integration scope

Component interactions against real dependencies (API to service to data store). Verify against the `TC-I-*` cases from the test-case artifact.

- **Home:** the project's existing integration tests and harness, from its `CLAUDE.md` and test skill.
- Use realistic boundaries, following the existing tests.
- Clean up data, or use the transaction or isolated test-database patterns the project already has.
- Seed scripts are development-only and repeatable; reusable ones live in the ticket's `tests/` folder and are linked from the test cases.
- Never point integration tests at production or a shared environment you do not own without an ASK.
- Every PASS shows the command and its output.
