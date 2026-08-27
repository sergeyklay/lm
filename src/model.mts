import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { providerConfig, endpoint, modelId, CONTEXT_TOKENS } from "./provider.mts";

// A verb is one call under a budget, so four fields the chat does not want are
// added here rather than in the shared provider: ollama's /v1 ignores the
// `max_completion_tokens` the harness sends for a provider it does not know and
// honours `max_tokens`, `reasoning_effort: "none"` is what stops this model
// thinking on that endpoint, which is the only way an answer fits the budget,
// and `temperature: 0` is what makes a verb's answer a function of its prompt.
// Without it the model's own modelfile decides, and this one asks for 1:
// `ollama show --modelfile qwen3.8:27b | grep temperature`.
// The fourth is `contextWindow`, and here the obvious change is the wrong one:
// reading `LM_CTX` like the chat's registration does makes the window the
// answer's ceiling, because `clampMaxTokensToContext` in the harness asks for
// `min(maxTokens, max(1, contextWindow - prompt - 4096))`. A verb accounts
// against no window (it compacts nothing and shows no percentage), so it takes
// the number this project declares and keeps its budget. `docs/verbs.md` carries
// what each variable does on each route.
export async function resolveModel() {
  const cfg = providerConfig();
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", {
    ...cfg,
    models: [{
      ...cfg.models[0],
      compat: { ...cfg.models[0].compat, maxTokensField: "max_tokens" as const },
      contextWindow: CONTEXT_TOKENS,
      samplingParams: { reasoning_effort: "none", temperature: 0 },
    }],
  });
  const model = runtime.getModel("ollama", modelId());
  if (!model) throw new Error(`lm: no model '${modelId()}' at ${endpoint()}`);
  return { runtime, model };
}
