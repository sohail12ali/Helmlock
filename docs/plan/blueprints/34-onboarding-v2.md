# Blueprint 34: Onboarding, rethought (2026-10-08)

The user: "The onboarding does not work well; rethink how it should be, then create it." The old setup page was a checklist of seven unrelated steps, two of them technical (agents copied, Claude trust), it detected little, and it ended on a checklist instead of working agents. Grounded in Paperclip's onboard command and first-run wizard, control-center's onboarding checklist and setup writer, and deepseek-harness's welcome screen.

## Principles
- Ask nothing that can be detected: git user name and email, CLIs on PATH and their versions, keys already in the environment or `.env` (names only, never values), LM Studio and Ollama on this machine, folders already in the workspace file.
- One question per screen; a three-part progress strip; Back always works; the draft survives a reload.
- A failed check warns with a fix and never blocks; only optional steps can be skipped.
- Technical upkeep is not a step: harness sync and the trusted-folder setup are repaired silently (as `hl doctor --repair` would) and only reported if they fail.
- The wizard writes the same files Settings edits, through the same verbs.
- It ends inside work: the first task becomes a ticket handed to a role, and the person lands on the ticket thread with the run streaming.

## Screens (console, `/welcome`)
Opens by itself only when there is no author or no usable engine; otherwise reachable from Overview and Settings.
1. **You.** "Is this you?" prefilled from git config (name, email, slug). Confirm writes the roster entry, `author.local` and claims the git name. Skipped when `author.local` already names a roster person.
2. **Engines.** Tiles for what was found: Claude Code and Cursor (found or not on PATH, version), each with a real "say hello" test returning ordered checks {code, level, message, hint}; model providers: keys found in the environment become one-click "Add OpenRouter (key found)" tiles, a local LM Studio or Ollama that answers becomes "Add LM Studio (running)", plus "Other provider" (the existing provider form). At least one usable engine is needed to continue.
3. **Your code.** Folders of the workspace file that are not projects yet (ticked), "Add a folder", "Import a .code-workspace". Skippable ("later").
4. **Your crew.** The six roles with the engine each will use, preset from what passed in step 2 (CLI agents for build roles, a model for analysis roles when one is available). Change any; Continue saves with `crew set`.
5. **Phone (optional).** Telegram token and allowed ids. Skippable.
6. **First task.** "What should we work on first?" one sentence plus the project; Start creates the ticket and hands it to the next-step role, then opens the ticket thread.

## Shared checks
One step list (`GET /api/v1/setup`) behind the wizard, an Overview card and `hl setup` in the terminal, so the three never disagree. Engine checks are the runtimes `test()` results, also shown by `hl doctor`.
