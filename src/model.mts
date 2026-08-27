import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { providerConfig, endpoint, modelId } from "./provider.mts";

// A verb is one call under a budget, so three fields the chat does not want are
// added here rather than in the shared provider: ollama's /v1 ignores the
// `max_completion_tokens` the harness sends for a provider it does not know and
// honours `max_tokens`, `reasoning_effort: "none"` is what stops this model
// thinking on that endpoint, which is the only way an answer fits the budget,
// and `temperature: 0` is what makes a verb's answer a function of its prompt.
// Without it the model's own modelfile decides, and this one asks for 1:
// `ollama show --modelfile qwen3.8:27b | grep temperature`.
export async function resolveModel() {
  const cfg = providerConfig();
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", {
    ...cfg,
    models: [{
      ...cfg.models[0],
      compat: { ...cfg.models[0].compat, maxTokensField: "max_tokens" as const },
      samplingParams: { reasoning_effort: "none", temperature: 0 },
    }],
  });
  const model = runtime.getModel("ollama", modelId());
  if (!model) throw new Error(`lm: no model '${modelId()}' at ${endpoint()}`);
  return { runtime, model };
}
