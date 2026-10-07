# Blueprint 19: lifecycle, compact, archive, delete (draft)

Too many files confuse an LLM, so the knowledge base needs a lifecycle: compact what is done, hide what is old, archive it reversibly, and delete only with safeguards. Cards: F124 to F129. Evidence is from your repos and the two public ones.

## The four tiers

| Tier | What it holds | Visible to agents by default? | How a ticket gets there |
|---|---|---|---|
| **Active** | `artifacts/T-xxx/` with the working files (hard cap of about 15 files) | Yes | Created by the scaffold; `keep` pin stops auto-archive; stale is only a flag |
| **Closed** | The same folder, now with `T-xxx-closure.md` (the digest) and drafts moved to `_work/` | The digest, yes; `_work/` no | `hl close` |
| **Archived** | `archive/YYYY-MM/T-xxx/` with `ticket.toml`, the digest, `manifest.json` and the bulk | No (only with `--archived`) | `hl archive --older-than 30d` after a dry run |
| **Deleted** | Nothing but a tombstone line | No | `hl purge` on an archived ticket |

```
knowledge repo
  artifacts/
    T-014/                       active or closed
      T-014-closure.md           the digest (kept, in the graph)
      _work/                     drafts, iteration logs, critiques (hidden)
  archive/
    2026-10/T-009/               archived: ticket.toml, T-009-closure.md, manifest.json, files...
    tombstones.jsonl             one line per deleted ticket
    closed-index.md              generated, capped: one line per closed or archived ticket
  .trash/                        optional: purged items for N days
```

## The closure digest (F125)

A fixed shape, about 400 words, `(none)` for an empty section:

```markdown
# T-014 closure digest
Outcome: Chose TOML for records, JSONL for history; shipped the format map and validator.
Decisions: D-001 TOML for records (stdlib reader, matches existing repos); D-002 JSONL for logs (append-safe).
Key files and links: [[T-014-spec]] | [[T-014-plan]] | db/forward/01_wms.GiftCard.Table.sql
Caveats: Rewriting loses comments; generated files carry none.
Follow-ups: T-021 per-record files.
```

The close skill drafts it; a verb checks the sections and the size. The digest stays visible and in the Obsidian graph after everything else is archived, so a link such as `[[T-014]]` still lands somewhere useful.

## Manifest and restore

```json
{"version":1,"ticket":"T-009","archived":"2026-10-30","files":{"T-009-spec.md":"sha256:ab12...","db/forward/01_wms.GiftCard.Table.sql":"sha256:cd34..."}}
```

`hl restore T-009` verifies the hashes and moves it back. A new ticket that links to an archived one can trigger an auto-restore of its digest only.

## Verbs (draft)

| Verb | Does |
|---|---|
| `hl close T-xxx` | Writes the digest, moves drafts to `_work/`, sets the stage |
| `hl pin T-xxx` | Sets `keep`: never auto-archived |
| `hl retention check` | Lists what is eligible to archive or purge (dry run) |
| `hl archive --older-than 30d` | Dry run by default; with `--apply` moves, writes the manifest, updates the index |
| `hl restore T-xxx` | Verifies hashes, moves back |
| `hl purge T-xxx` | See safeguards below |
| `hl delete note|decision|log ...` | The same safeguards for other information |

## Deleting safely (F128)

1. Only archived tickets, unless you give a reason to override.
2. Dry run first: list files, sizes and inbound links.
3. A typed confirmation (the ticket id).
4. **Value check:** promote any lasting rationale to `shared/wiki/decisions` or the decision log before deleting (deepseek-harness: "git history as the only copy" is rejected).
5. **Inbound links:** refuse, or repair by pointing them at the tombstone.
6. **Tombstone:** append `{id, title, closed, deleted, reason, hash, digest}` to `archive/tombstones.jsonl`.
7. Optional trash window of N days; one audit line.

## Hiding from the LLM (F126)

| Layer | How |
|---|---|
| Search tools | Ignore files list `archive/` and `**/_work/` (a `.rgignore`; Cursor ignore equivalents) |
| Host deny rules | Claude `permissions.deny` and Cursor `Read` deny for those folders; generated from one source |
| Defaults | `hl search` and `hl context` cover active tickets and capped closed digests; `--archived` includes the rest |
| Caps | The session-start digest and the generated index show about 12 rows or 1,200 characters, with a visible "...N more" |
| Obsidian | The archive folder is in the excluded files; digests stay in the graph |
| Active size | A validator warns above about 15 files in an active ticket |

## Retention settings (F127)

```toml
[retention]
stale_days = 14                    # flag only
archive_after_closed_days = 30     # suggested, applied by a verb
purge_eligible_after_days = 180    # never automatic
trash_days = 14
```

## Compacting other things (F129)

| Thing | Rule |
|---|---|
| JSONL history (chat, usage, audit) | Rotate monthly, gzip old months (zstd where available) |
| Usage and audit lines | Daily aggregates for dashboards, raw lines compressed |
| Old chats | A fixed-section checkpoint (request, files, pending, next step, critical context) plus the compressed raw log |
| Work logs | Leave daily files; a monthly summary note; old months to a logs archive |
| Generated pages and notes | Never stored in git; rebuilt |
| Large agent output | Spilled to a file with a preview and a pointer; swept after about 30 days |

## Evidence from the four repos

| Repo | What it does | Lesson |
|---|---|---|
| lc-wms | Board `archived` flag and `unarchive`; session digest capped at 12 rows; `close-ticket` writes a closure summary; no delete verb; closed items still appear in the index | Archive on the board is not enough; hide and cap |
| control-center | `close-work` archive step exists only as skill text; digest capped at 1,200 characters; `reset` has a dry run and typed confirmation; a closed ticket holds 23 flat files | Cap the digest, copy the reset safety, avoid file sprawl |
| deepseek-harness | Archive with an append-only sha256 manifest; one ignore line hides it; judgement by future decision value, not age; compaction checkpoint of fixed sections; spill with preview | Value test, manifest, fixed-section digest |
| paperclip | Per-user archive that resurfaces on new activity; idle auto-archive at 90 days; 7-day reopen cooldown; hard delete with an audit entry and a redaction tombstone; tiered backup retention | Suggest by age, tombstone, short undo window |
