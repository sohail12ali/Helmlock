# /verify: e2e scope

Full user workflows, only when UI is in scope. Verify against the `TC-E-*` cases from the test-case artifact.

- **Home and tool:** the project's existing end-to-end suite and runner, from its `CLAUDE.md` and test skill. Environment setup comes from the project layer too.
- Prefer stable selectors: test ids or accessibility labels the UI already exposes. A missing hook on a clear AC is a fixable failure, not a reason to skip.
- Keep scenarios minimal and deterministic; never trade stability for coverage with flaky UI tests.
- Confirm the build under test matches the branch before trusting any result.
- Every PASS shows the command and its output, plus a screenshot or log when the runner produces one.
