---
name: log-work
description: Append one work-log line for the current person, or show a timesheet summary. One plain sentence; the tool owns storage, author, dedupe and hours. Use when the Stop hook reminds you at session end, after shipping, or for "what did I do this week".
---

# /log-work

```text
/log-work {T | -} "{what shipped}" [--category C] [--weight 1-5] [--hours N]
/log-work summary [--week] [--author {initials}]
```

**Reads:** `hl log show` (summary mode) · **Writes:** one entry in today's file for the current person, through `hl log-work` only

## Steps

1. Pick the mode: a sentence to log, or `summary`.
2. **Log:** pick the key (Which key below) and write one sentence (What you supply). **You write one sentence; the tool does everything else.**

   ```
   hl log-work {T | -} "{what shipped}" [--category C] [--weight 1-5] [--hours N]
   ```

   Storage (one file per person per day), the author (from the roster, never guessed), duplicate detection (about 70% similar text on the same ticket and day is skipped) and hour allocation live in the tool. Do not re-derive them in a prompt. A rejection names the rule: fix the sentence and run it once more.
3. **Summary:** run `hl log show [--week] [--author {initials}]` and post the output as it is. Do not recompute hours, totals or grouping. Add `--json` only when another tool reads it.

## Rules

### What you supply

| Field | Rule |
|-------|------|
| **Ticket** | the real ticket id (`T-014-sa`), or `-` for work with no ticket |
| **Text** | One plain sentence: what shipped, was fixed, reviewed or tested. At most 160 characters. **No** semicolons, colons, pipes, asterisks, hashes, dashes or apostrophes; join clauses with "and". The tool rejects them. |
| **Category** | `Development` (default) · `Code Review` · `Testing` · `Design` · `Documentation` · `Internal` |
| **Weight** | 1 to 5, a share of the day. Default 2. |
| **Hours** | Only for a fixed block (a two-hour meeting). Normally omit it; weights split the day. |

**Never** put agent names, skill names, task ids or process talk ("resolved questions", "attempted X") in the text. The log is a timesheet for people. Good: `Added retry to the nightly export and covered it with tests`. Weak: `Builder ran S1-T2 via /fix`.

### Which key

- Delivery work always logs on the **real** ticket.
- Meetings, leave and other non-delivery time use the special keys your workspace defines (its `CLAUDE.md` or its own log rules), never a delivery ticket.
- No ticket and no special key: `-` with `--category Internal`.

### When to log

- Once per session that shipped something, when the Stop hook reminds you; one line for the whole session, not one per step or per agent.
- Ticket stage moves never write the work log.
- Read-only or aborted sessions log nothing.
- The entry is attributed to the person who ran the session, never to an agent. Do not log for another person unless they asked.

## Output

The tool's confirmation line (or its skip or rejection message), then nothing more. Summary mode: the `hl log show` output as printed.
