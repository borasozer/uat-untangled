import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "../env";

/**
 * Every Claude call in the app goes through structuredCall: the three runs for each report (analyse.ts) and the quick
 * check on the report form (evidence.ts). It returns the answer already checked against a Zod schema, with the model that
 * answered, the time taken and the token counts the cost is worked out from (pricing.ts). Server code only: the SDK reads
 * the Anthropic key from the server's environment, and it never reaches the browser. The three errors this file throws are
 * worded for the person on the page; errors from the SDK itself (a timeout, an overloaded API) pass through unchanged, and
 * the actions and the import route show both as they are.
 */

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  // Bounded retries and a timeout: a stuck request must not keep a server function (and its bill) running.
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 90_000 });
  return client;
}

/** The checked answer, the model that really answered (a fallback may not be AI_MODEL), the time in ms, the tokens. */
export type StructuredResult<T> = {
  value: T;
  model: string;
  latencyMs: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
};

/**
 * One structured call to Claude. The stable context goes first in the system prompt and is cached;
 * the volatile context (tickets, pending reports) follows it. If the model declines for safety
 * reasons, the server-side fallback re-runs the request on Anthropic's recommended model.
 */
export async function structuredCall<S extends z.ZodType>(opts: {
  schema: S;
  stableSystem: string;
  volatileSystem: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** For calls a person is waiting on: give up sooner than the client's default, and do not retry. */
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<StructuredResult<z.infer<S>>> {
  const started = Date.now();
  const response = await anthropic().beta.messages.parse({
    model: env.aiModel,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: opts.stableSystem, cache_control: { type: "ephemeral" } },
      { type: "text", text: opts.volatileSystem },
    ],
    messages: [{ role: "user", content: opts.user }],
    output_config: {
      effort: opts.effort ?? "medium",
      format: betaZodOutputFormat(opts.schema),
    },
  }, {
    ...(opts.timeoutMs !== undefined && { timeout: opts.timeoutMs }),
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
  });

  if (response.stop_reason === "refusal") {
    console.error("Claude declined", response.stop_details?.category ?? "no category");
    throw new Error("The AI declined to review this report.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The AI's answer was cut off. Please try again.");
  }
  if (!response.parsed_output) {
    throw new Error("The AI's answer could not be read. Please try again.");
  }
  return {
    value: response.parsed_output as z.infer<S>,
    model: response.model,
    latencyMs: Date.now() - started,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
    },
  };
}
