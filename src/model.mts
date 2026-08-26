import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export async function resolveModel(baseUrl: string, id: string, contextWindow: number) {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", {
    name: "ollama",
    baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`,
    api: "openai-completions",
    apiKey: "ollama",
    models: [
      {
        id,
        name: id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: 3000,
        compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      },
    ],
  });
  const model = runtime.getModel("ollama", id);
  if (!model) throw new Error(`lm: no model '${id}' at ${baseUrl}`);
  return { runtime, model };
}
