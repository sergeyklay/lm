export const endpoint = () => (process.env.LM_OLLAMA ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const modelId = () => process.env.LM_MODEL ?? "qwen3.8:27b";
export const SERVED_CONTEXT_TOKENS = 65536;
export const MAX_TOKENS = 3000;
export const contextWindow = () => Number(process.env.LM_CTX ?? SERVED_CONTEXT_TOKENS);
export const maxTokens = () => Number(process.env.LM_MAX_TOKENS ?? MAX_TOKENS);
export const think = () => process.env.LM_THINK ?? "none";

// A chat turn is bounded by the context window and by the person watching it
// stream, so it asks for no budget at all, and 0 is what leaves the field off
// the wire rather than what sends a zero. A verb is one call under a budget and
// declares its own in `src/model.mts`.
export const NO_ANSWER_BUDGET = 0;

export function providerConfig() {
  const id = modelId();
  return {
    name: "ollama",
    baseUrl: `${endpoint()}/v1`,
    api: "openai-completions" as const,
    apiKey: "ollama",
    models: [
      {
        id,
        name: id,
        reasoning: false,
        input: ["text"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: contextWindow(),
        maxTokens: NO_ANSWER_BUDGET,
        // What the harness's own `/thinking` needs to reach this endpoint. Its
        // `off` sends no field, which on ollama's `/v1` is the state the model
        // thinks in, so the level that reads as closed is mapped to the one thing
        // measured to close it. `reasoning` is the card's own answer and is
        // supplied per model by `catalogue()`; false is what a machine that
        // cannot be asked gets. `input` stays text: nothing here sends an image.
        thinkingLevelMap: { off: "none" },
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
      },
    ],
  };
}
