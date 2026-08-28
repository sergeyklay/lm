import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { providerConfig, endpoint, maxTokens, modelId, SERVED_CONTEXT_TOKENS, think } from "./provider.mts";

// A verb is one call under a budget, so four settings the chat does not want are
// added here rather than in the shared provider: the budget itself, under
// `max_tokens`, because ollama's /v1 ignores the `max_completion_tokens` the
// harness sends for a provider it does not know; `reasoning_effort`, which is
// `none` unless `LM_THINK` names another effort, because a model that does not
// think is the only way an answer fits the budget; and `temperature: 0`, what
// makes a verb's answer a function of its prompt.
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
      contextWindow: SERVED_CONTEXT_TOKENS,
      maxTokens: maxTokens(),
      samplingParams: { reasoning_effort: think(), temperature: 0 },
    }],
  });
  const model = runtime.getModel("ollama", modelId());
  if (!model) throw new Error(`lm: no model '${modelId()}' at ${endpoint()}`);
  return { runtime, model };
}
