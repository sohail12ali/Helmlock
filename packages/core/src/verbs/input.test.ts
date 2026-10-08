import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { describeInput } from "./input.ts";

test("describeInput reads flags written as unions, preprocess and transforms", () => {
  const fields = describeInput(
    z.object({
      a: z
        .union([z.boolean(), z.enum(["true", "false"])])
        .optional()
        .transform((v) => v === true || v === "true"),
      b: z.preprocess((v) => v === "true", z.boolean()).optional(),
      c: z.union([z.string(), z.array(z.string())]).optional(),
      d: z.coerce.number().optional(),
      e: z.string(),
    }),
  );
  const kind = Object.fromEntries(fields.map((f) => [f.key, f.kind]));
  assert.deepEqual(kind, { a: "boolean", b: "boolean", c: "array", d: "number", e: "string" });
  assert.equal(fields.find((f) => f.key === "e")?.required, true);
  assert.equal(fields.find((f) => f.key === "a")?.required, false);
});
