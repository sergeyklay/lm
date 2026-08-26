import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { providerConfig, endpoint, modelId } from "./provider.mts";

// A verb is one call under a budget, so two fields the chat does not want are
// added here rather than in the shared provider: ollama's /v1 ignores the
// `max_completion_tokens` the harness sends for a provider it does not know and
// honours `max_tokens`, and `reasoning_effort: "none"` is what stops this model
// thinking on that endpoint, which is the only way an answer fits the budget.
export async function resolveModel() {
  const cfg = providerConfig();
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", {
    ...cfg,
    models: [{
      ...cfg.models[0],
      compat: { ...cfg.models[0].compat, maxTokensField: "max_tokens" as const },
      samplingParams: { reasoning_effort: "none" },
    }],
  });
  const model = runtime.getModel("ollama", modelId());
  if (!model) throw new Error(`lm: no model '${modelId()}' at ${endpoint()}`);
  return { runtime, model };
}
