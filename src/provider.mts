export const endpoint = () => (process.env.LM_OLLAMA ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const modelId = () => process.env.LM_MODEL ?? "qwen3.8:27b";
export const SERVED_CONTEXT_TOKENS = 65536;
export const MAX_TOKENS = 3000;
export const contextWindow = () => Number(process.env.LM_CTX ?? SERVED_CONTEXT_TOKENS);
export const maxTokens = () => Number(process.env.LM_MAX_TOKENS ?? MAX_TOKENS);

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
        maxTokens: maxTokens(),
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      },
    ],
  };
}
