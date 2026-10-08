# Stage: audit

`/challenge audit {project or path}`: the **lean** lens (rules.md, Review lenses) over a whole repo or folder, with no ticket. Use before a cleanup ticket, when sizing cleanup, or when a repo feels heavier than its job.

## Inputs

- The project, resolved with `/project-layout`; read its `CLAUDE.md` first.

## Steps

1. Map the tree: modules, dependencies, top-level folders. Skip build output, generated code and vendored files.
2. Hunt, biggest cut first:
   - dependencies doing what the standard library or the platform already does
   - interfaces with one implementation, factories with one product, wrappers that only pass calls through
   - helpers that duplicate one elsewhere in the repo
   - dead flags, settings nobody reads, unreachable branches, unused fields the code still maps
   - hand-written loops, parsers or caches a built-in covers
3. Before any `delete`, search for the symbol across code, config, registrations and string or reflection use. Still referenced: not a `delete`.
4. Leave correctness, security and speed alone; they belong to `/challenge {T} implementation` and `/verify {T} review`. An intentional `shortcut:` marker is not a finding.

## Output

Chat only; writes nothing. Numbered, so the person can say "ticket 2 and 5":

```
1. {path}:{line}: {delete|reuse|builtin|platform|yagni|shrink} {what to cut}. {replacement}.
2. ...
net: about -{N} lines, -{M} dependencies possible.
```

Nothing to cut: `lean already, checked {what}`. Next: `/ticket-draft` for the cuts worth a ticket.
