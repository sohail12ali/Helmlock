// Telegram on your phone (optional): the bot token saved on this machine only (MachineSecret -> `secret set`) and the
// allowed user ids (`config set`, workspace.local.toml). Used by the /welcome wizard's Phone screen.
import { useId, useState } from "react";
import { INVALIDATE, useSettings } from "@/api/write-hooks";
import { Mono } from "@/components/common";
import { Field } from "@/components/forms/controls";
import { useVerbRun } from "@/components/forms/useVerbRun";
import { VerbResult } from "@/components/forms/VerbResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MachineSecret } from "./MachineSecret";
import { ENV_NAME, splitList } from "./presets";

export function TelegramSetup() {
  const uid = useId();
  const settings = useSettings();
  const plugin = settings.data?.sections.flatMap((s) => s.plugins).find((p) => p.plugin === "telegram");
  const cur = (k: string) => plugin?.values[k]?.value;
  const curIds = cur("allowed_user_ids");
  const [tokenEnv, setTokenEnv] = useState<string>();
  const [ids, setIds] = useState<string>();
  const tokenDraft = tokenEnv ?? (typeof cur("token_env") === "string" ? (cur("token_env") as string) : "HL_TELEGRAM_TOKEN");
  const idsDraft = ids ?? (Array.isArray(curIds) ? curIds.join(", ") : typeof curIds === "string" ? curIds : "");
  const invalidate = [...INVALIDATE.settings, "setup", "secrets"];
  const token = useVerbRun("config set", invalidate);
  const allow = useVerbRun("config set", invalidate);
  const [problem, setProblem] = useState<string>();
  const savedName = typeof cur("token_env") === "string" && ENV_NAME.test(cur("token_env") as string) ? (cur("token_env") as string) : "HL_TELEGRAM_TOKEN";
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-ink2">
        <li>
          In Telegram, open a chat with <Mono>@BotFather</Mono> and send <Mono>/newbot</Mono>.
        </li>
        <li>Pick a name and a username ending in "bot". BotFather replies with a token.</li>
        <li>Paste the token below and save it on this machine. It never goes into the repo.</li>
        <li>
          Send any message to <Mono>@userinfobot</Mono> to learn your numeric user id, and allow it below.
        </li>
        <li>The bot starts by itself once both are saved; no restart needed. Everyone not allowed gets nothing.</li>
      </ol>
      <MachineSecret name={savedName} label="Bot token" placeholder="123456:ABC..." />
      <div>
        <Button size="sm" variant="ghost" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? "Hide" : "Advanced:"} token variable name
        </Button>
      </div>
      {advanced && (
        <>
          <Field
            label="Bot token variable (name only)"
            htmlFor={`${uid}-tok`}
            hint="Only if the token already lives in another environment variable. Stored in workspace.local.toml (this machine only)."
          >
            <div className="flex flex-wrap gap-2">
              <Input id={`${uid}-tok`} className="max-w-xs font-mono" value={tokenDraft} onChange={(e) => setTokenEnv(e.target.value)} />
              <Button
                size="sm"
                disabled={token.pending}
                onClick={() => {
                  setProblem(undefined);
                  if (!ENV_NAME.test(tokenDraft.trim()))
                    return setProblem("That is not a variable name. To save the token itself, paste it into Bot token above.");
                  void token.run({ plugin: "telegram", key: "token_env", value: tokenDraft.trim(), local: true });
                }}
              >
                Save variable
              </Button>
            </div>
          </Field>
          {token.last && <VerbResult result={token.last.result} okText="Saved." />}
        </>
      )}
      <Field label="Allowed Telegram user ids" htmlFor={`${uid}-ids`} hint="Comma-separated numeric ids. Empty means nobody (fail-closed).">
        <div className="flex flex-wrap gap-2">
          <Input
            id={`${uid}-ids`}
            className="max-w-xs font-mono"
            value={idsDraft}
            onChange={(e) => setIds(e.target.value)}
            placeholder="123456789, 987654321"
          />
          <Button
            size="sm"
            disabled={allow.pending}
            onClick={() => {
              setProblem(undefined);
              const list = splitList(idsDraft);
              if (list.some((x) => !/^\d+$/.test(x))) return setProblem("Telegram user ids are numbers.");
              void allow.run({ plugin: "telegram", key: "allowed_user_ids", value: list, local: true });
            }}
          >
            Save ids
          </Button>
        </div>
      </Field>
      {allow.last && <VerbResult result={allow.last.result} okText="Saved." />}
      {problem && (
        <p role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Telegram is optional. Skip it for now; it can be set later under Settings.</p>
    </div>
  );
}
