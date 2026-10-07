// WALKING SKELETON (wave 0). S1 completes: ACT/ASK policy, interactive prompt in a TTY, fail-closed timeout.
import type { ApprovalsService } from "../contracts/services.ts";

export function createApprovals(): ApprovalsService {
  return {
    async decide(req) {
      return { decision: "deny", reason: `no approver available for ${req.action} (fail-closed)` };
    },
  };
}
