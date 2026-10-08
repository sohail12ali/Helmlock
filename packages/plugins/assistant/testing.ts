// Test helpers for the assistant: a fake approval queue (the real one is another plugin) and an event collector.
import type { ApprovalCardData, ApprovalQueueService, AssistantEvent } from "@helmlock/core";

export function fakeQueue(
  decision: "allow" | "deny",
  scope: "once" | "chat" = "once",
): ApprovalQueueService & { cards: ApprovalCardData[]; decision: "allow" | "deny" } {
  const cards: ApprovalCardData[] = [];
  const q: ApprovalQueueService & { cards: ApprovalCardData[]; decision: "allow" | "deny" } = {
    cards,
    decision,
    request(req) {
      const card: ApprovalCardData = { ...req, id: `ap-${cards.length + 1}`, created: new Date().toISOString(), expires: "", status: "pending" };
      cards.push(card);
      return new Promise<ApprovalCardData>((ok) =>
        setTimeout(() => {
          card.status = q.decision === "allow" ? "allowed" : "denied";
          card.decided_by = "sam";
          card.decided_via = "console";
          card.scope = scope;
          ok({ ...card });
        }, 10),
      );
    },
    pending: () => cards.filter((c) => c.status === "pending"),
    recent: () => [...cards],
    answer: (): ApprovalCardData => {
      throw new Error("not used");
    },
  };
  return q;
}

export async function collect(it: AsyncIterable<AssistantEvent>): Promise<AssistantEvent[]> {
  const out: AssistantEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
