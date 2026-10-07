// Closed emitters for every file this plugin writes: one kind, one schema, one key order.
import { BugRecord, DecisionRecord, GapRecord, QuestionRecord, type RecordKindName, TasksToml, TicketToml, type TomlEmitter } from "@helmlock/core";

export const RECORD_FOLDERS: Record<RecordKindName, string> = {
  decision: "decisions",
  question: "questions",
  bug: "bugs",
  gap: "gaps",
};
export const RECORD_PREFIX: Record<RecordKindName, "D" | "Q" | "B" | "G"> = {
  decision: "D",
  question: "Q",
  bug: "B",
  gap: "G",
};
export const KIND_BY_PREFIX: Record<string, RecordKindName> = { D: "decision", Q: "question", B: "bug", G: "gap" };

const ticket: TomlEmitter = {
  kind: "ticket",
  schema: TicketToml,
  version: 1,
  order: {
    "": ["schema_version", "ticket", "flags", "claim", "links", "changes"],
    ticket: ["id", "title", "summary", "stage", "size", "priority", "owner", "project", "goal", "created", "updated"],
    flags: ["blocked", "blocked_by", "next_action"],
    claim: ["claimed_by", "claimed_at"],
    links: ["parent", "related"],
    changes: ["repo", "branch"],
  },
};

const decision: TomlEmitter = {
  kind: "decision",
  schema: DecisionRecord,
  version: 1,
  order: { "": ["schema_version", "id", "ticket", "title", "status", "chosen", "why", "rejected", "date", "author"] },
};

const question: TomlEmitter = {
  kind: "question",
  schema: QuestionRecord,
  version: 1,
  order: { "": ["schema_version", "id", "ticket", "text", "blocking", "status", "options", "answer", "asked", "answered", "author"] },
};

const bug: TomlEmitter = {
  kind: "bug",
  schema: BugRecord,
  version: 1,
  order: { "": ["schema_version", "id", "ticket", "title", "severity", "status", "found_in", "fixed_in", "date", "author"] },
};

const gap: TomlEmitter = {
  kind: "gap",
  schema: GapRecord,
  version: 1,
  order: { "": ["schema_version", "id", "ticket", "text", "category", "status", "date", "author"] },
};

const tasks: TomlEmitter = {
  kind: "tasks",
  schema: TasksToml,
  version: 1,
  order: {
    "": ["schema_version", "ticket", "task"],
    task: ["id", "slice", "title", "layer", "acs", "estimate_h", "actual_h", "status", "depends", "files"],
  },
};

export const EMITTERS: readonly TomlEmitter[] = [ticket, decision, question, bug, gap, tasks];
