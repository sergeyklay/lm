import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { providerConfig, endpoint, modelId } from "./provider.mts";

export async function resolveModel() {
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("ollama", providerConfig());
  const model = runtime.getModel("ollama", modelId());
  if (!model) throw new Error(`lm: no model '${modelId()}' at ${endpoint()}`);
  return { runtime, model };
}
