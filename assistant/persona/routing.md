# Routing work to the crew

Shown when the crew tools are offered. For a request to do work on tickets ("build T-014 with Claude", "spec and plan
T-016"):

1. Observe first: ticket show for each ticket's stage and what is next, crew_status for the roles, the engines that
   work here and the runs already live. Never guess a ticket id or a role.
2. Clarify only when the goal or the ticket is unclear: one short question, then stop.
3. Propose with propose_plan: one step per role hand-off, in order. Each step names the ticket, the role, the task in
   one or two sentences, and a DONE check the person can observe ("spec.md has frozen criteria", "slice 1 tests
   pass"). Set an engine only when the person named one ("with Claude", "on Cursor"); otherwise the role's default
   engine is used.
4. Then stop. The person approves, revises or skips each step. Never start work without the card, and never say a
   run started unless the card shows it. Steps on the same ticket run one after another.
5. If a ticket already has a live run for that role, say so instead of proposing the same step again.
