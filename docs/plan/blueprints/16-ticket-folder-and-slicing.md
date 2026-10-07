# Blueprint 16: ticket folder, slicing and database scripts (draft)

Built from your real tickets: lc-wms layout 3 (WLC-973 with SQL and rollback, WLC-975 with an investigation) and control-center (T-017, 23 flat files). Cards: F111 (slicing), F112 (folder), F113 (database), F114 (tests).

## Vocabulary (F111)

| Word | Means | Notes |
|---|---|---|
| **Ticket** | One unit of delivery with a size S, M or L | `ticket.toml` holds its state |
| **Slice** (`S1`..`Sn`) | A thin vertical cut through every layer it needs, delivering at least one acceptance criterion end to end; riskiest first; shippable and testable on its own | One slice for size S, two to five for M and L, more than six means split the ticket |
| **Task** (`S1-T1`) | One piece of work in exactly one layer | Sizes 0.5, 1, 1.5, 2 or 3 hours |
| **Layer** | `db`, `api`, `ui`, `test`, `env`, `spike`, `docs` (configurable per workspace) | An attribute of a task, not a way to slice |
| **Stage** | Where a ticket is in the pipeline (backlog, spec, plan, build, verify, done) | lc-wms calls this a phase; we avoid "phase" for slicing |
| **Wave** | A group of tasks or slices that run in parallel agents | A runtime idea; never crosses a stage; at most 6 tasks |

Why not phases then slices: lc-wms rejects layer phases ("nothing works until the last phase lands"), and control-center ticket T-017 grew to 4 phases, 10 slices and about 60 tasks.

### `tasks.toml`

```toml
schema_version = 1

[[task]]
id = "S1-T1"
slice = "S1"
title = "Add gift-card table and stored procedure"
layer = "db"
acs = ["AC-1"]
estimate_h = 2
status = "todo"            # todo | doing | done | blocked
depends = []
files = ["db/forward/01_wms.GiftCard.Table.sql"]

[[task]]
id = "S1-T2"
slice = "S1"
title = "API endpoint to redeem a gift card"
layer = "api"
acs = ["AC-1"]
estimate_h = 3
depends = ["S1-T1"]
```

The validator fails an acceptance criterion with no task and a task with no acceptance criterion; it warns on an AC with no test case.

## The ticket folder (F112)

```
artifacts/T-014/
  ticket.toml                  state only, written by the CLI
  T-014-spec.md                what and why: summary, scope, business rules, AC (Given/When/Then)
  T-014-plan.md                how: impact, design, slices; plan approval line
  tasks.toml                   slices and tasks, ids S1-T1
  decisions/  questions/  bugs/  gaps/      one TOML file per record (F62), created when first used
  architecture/                diagrams, ADR-style notes, generated brief.html
  db/                          SQL for this ticket
    forward/NN_{schema}.{object}.sql
    rollback/NN_{schema}.{object}.rollback.sql
    dev/                       throwaway development and diagnostic SQL, never released
    README.md                  catalog order and rollback order
  test-cases/                  T-014-test-cases.md (TC ids traced to AC), reports, evidence/
  tests/                       ticket-local executable checks (SQL, Python, shell), not product tests
  source/                      immutable stakeholder input (documents, spreadsheets, screenshots)
  investigations/              INV-... notes from before or during the ticket
  T-014-release-notes.md
```

| Entry | Why it is there |
|---|---|
| `ticket.toml` | Lifecycle state in one place; frontmatter never carries stage or status |
| spec and plan | Prose that agents and people edit directly |
| `tasks.toml` | Machine-readable slices and tasks for validation and the board |
| record folders | One file per record merges cleanly in a team and maps to one Obsidian note |
| `db/forward` and `db/rollback` | Pairs are visible and machine-checked |
| `db/dev` | Keeps diagnostic SQL out of releases |
| `test-cases/` | The test plan that traces back to acceptance criteria |
| `tests/` | Runnable proof that lives with the ticket |
| `source/` | The only place binaries (docx, xlsx, pdf, msg) are allowed |

**Lazy folders:** a folder exists only once it holds a file; the scaffold writes `ticket.toml` and nothing else. File names carry the ticket id (F26), so links like `[[T-014-spec]]` are unique in Obsidian.

### What changed from lc-wms, and why

| lc-wms today | Proposed | Reason |
|---|---|---|
| `ticket-scripts/release-scripts/created-or-altered/[type]/` and `rollback-scripts/` | `db/forward/` and `db/rollback/` | Shorter paths, pairs side by side |
| A separate `inserts-or-deletes` folder (spelled three ways, not copied by staging) | DML in `db/forward/` with a preview flag | Removes a known pitfall |
| Type folders order scripts (tables, types, views, functions, procedures) | Numbering `NN_` is the order | One rule, checkable |
| Rollback pairing not enforced; the `.rollback.sql` suffix is not matched by the validator | Same `NN` in forward and rollback; validator warns on an unpaired script | Safe rollbacks |
| `development-scripts`, `handy-scripts`, `reference-scripts` | `db/dev/` for throwaway, shared snippets move to `shared/sql` (Blueprint 17) | Reuse stops being per ticket |
| Trackers as single TOML files | One file per record | Fewer merge conflicts |

## Database scripts (F113)

```
db/forward/01_wms.GiftCard.Table.sql
db/forward/02_wms.spRedeemGiftCard.StoredProcedure.sql
db/rollback/01_wms.GiftCard.rollback.sql
db/rollback/02_wms.spRedeemGiftCard.rollback.sql
```

- Each script begins with the catalog line (`USE [WMS]; GO`); the catalog is read from it.
- **Rollback content:** restore the previous procedure body from the baseline, or drop and delete for new objects. The README lists rollback order, which is the reverse of forward order.
- **Multi-catalog tickets:** numbered folders such as `db/forward/01_ams_2/` and `02_wms/`; deploy AMS_2 before WMS; rollbacks run in reverse.
- **DML safety:** a preview parameter (`@ExecuteMigration BIT = 0`) so a dry run shows effects first.
- **Approvals (kept from lc-wms):**
  - Any new or altered table needs an approved question before slices exist. The plan records `Approval: approved {date} by {user} — Q-n`, and the validator fails a ticket past planning while it says pending.
  - Production SQL of any kind and database writes always ask.
  - Live releases need the release email step; a human sends it.
- **Release packaging** (`run-all.sql`, `rollback-all.sql`, `DEPLOY.md`, `package.toml` per environment, promotion to the SQL mirror) is ShopLC-specific. It stays a **workspace or project skill**, not part of the system layer.

## Tests (F114)

- `test-cases/T-014-test-cases.md`: case ids `TC-U`, `TC-I`, `TC-E`, `TC-N`, `TC-B`, `TC-X` plus a number, stable and append-only, a matrix mapping each AC to cases, priority P0 to P2. Reports are `T-014-test-report-{date}.md`; proof goes in `evidence/`.
- Executable product tests (C#, Selenium, and so on) live in the **project repo**.
- `tests/` holds ticket-local checks: SQL verification, small Python or shell scripts, seed data. They are linked from the test cases. Every PASS shows the command and the output.
- Bugs found in verify become records in `bugs/` and route to the fixer.

## The layout rules as data

The folder rules live in one data file read by the validator, as in lc-wms (`ticket-layout.toml`), so changing the layout is a data edit:

```toml
[root]
files = ["ticket.toml", "{T}-spec.md", "{T}-plan.md", "tasks.toml", "{T}-release-notes.md"]
dirs  = ["decisions", "questions", "bugs", "gaps", "architecture", "db", "test-cases", "tests", "source", "investigations"]

[dirs.db]
allow = ["forward", "rollback", "dev", "README.md"]
pair  = { forward = "forward/NN_*.sql", rollback = "rollback/NN_*.rollback.sql" }

[dirs.source]
binary_ok = true
```

## Open points

- Keep lc-wms spellings for existing tickets and migrate only new ones, or migrate all (question in the plan).
- Whether `decisions.md` (a dated table) is needed next to per-record decision files.
