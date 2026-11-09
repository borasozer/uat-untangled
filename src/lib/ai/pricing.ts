/** USD per million tokens (Anthropic first-party API, cached 2026-10-06). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** In US dollars. Null for a model not in PRICES; the budget then records its high estimate instead. */
export function estimateCostUsd(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_input_tokens * p.cacheRead +
      u.cache_creation_input_tokens * p.cacheWrite) /
    1_000_000
  );
}
