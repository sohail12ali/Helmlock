**Helmlock** is a **lite, local-first agentic delivery system**: a small console plus agents and skills that take work from idea to verified delivery, with a knowledge base that remembers everything.

- It learns from four existing systems: **lc-wms-cursor-config** (agents and skills) and **control-center** (voice and tool design), both yours, plus **deepseek-harness** and **paperclip** (public, ideas only).
- **Two independent repos.** The *delivery repo* holds the skills, agents and console and knows nothing about any knowledge repo. A *knowledge repo* is the workspace root: it picks the delivery repo and lists the projects it works on.
- **Eleven features** you named: onboarding, knowledge center, two-repo system, Telegram, program-with-agents style, work logging, ticket tracking, todo/task, settings, dashboard, and a basic assistant for OpenAI-compatible models.
- Claude Code is the host (`CLAUDE.md`, `.claude/skills`, `.claude/agents`). Agents read compact files; humans get generated pages.
