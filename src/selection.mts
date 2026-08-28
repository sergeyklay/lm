import { modelId } from "./provider.mts";

// What the chat opens on, which is not what a verb asks. `LM_MODEL` names the
// verb's model and is the chat's default rather than its override: a model the
// operator chose inside the chat and saved is an explicit choice, and passing
// `--model` would overrule it on every launch. So the flags are handed to the
// harness only when it has no saved choice of its own, and `findInitialModel` in
// `dist/core/model-resolver.js` reads that choice from the settings file when
// nothing reaches `main()` ahead of it.
export function initialSelection(settings: {
  getDefaultProvider(): unknown;
  getDefaultModel(): unknown;
}): string[] {
  const savedInPi = Boolean(settings.getDefaultProvider() && settings.getDefaultModel());
  return savedInPi ? [] : ["--provider", "ollama", "--model", modelId()];
}
