import { modelId } from "./provider.mts";

type SavedChoice = { getDefaultProvider(): unknown; getDefaultModel(): unknown };

const savedInPi = (settings: SavedChoice) =>
  Boolean(settings.getDefaultProvider() && settings.getDefaultModel());

// The provider the chat registers, and the one a launch with nothing saved opens
// under. It travels beside the model id everywhere the two are compared, because
// two providers can serve one name and the harness saves them together.
const CHAT_PROVIDER = "ollama";

// A model is the pair, never the id alone: `modelsAreEqual` in the harness
// compares both, and a default saved under one provider is not the model in
// force under another that happens to serve the same name.
export type ModelChoice = { provider: string; model: string };

// What the chat opens on, which is not what a verb asks. `LM_MODEL` names the
// verb's model and is the chat's default rather than its override: a model the
// operator chose inside the chat and saved is an explicit choice, and passing
// `--model` would overrule it on every launch. So the flags are handed to the
// harness only when it has no saved choice of its own, and `findInitialModel` in
// `dist/core/model-resolver.js` reads that choice from the settings file when
// nothing reaches `main()` ahead of it.
export function initialSelection(settings: SavedChoice): string[] {
  return savedInPi(settings) ? [] : ["--provider", CHAT_PROVIDER, "--model", modelId()];
}

// The model the next launch will open on, decided in the same order and read
// back so the chat can say when the model in force is not it.
export function modelAtNextLaunch(settings: SavedChoice): ModelChoice {
  return savedInPi(settings)
    ? { provider: String(settings.getDefaultProvider()), model: String(settings.getDefaultModel()) }
    : { provider: CHAT_PROVIDER, model: modelId() };
}

// The level a chat opens on when nothing else says so, and a seed rather than an
// override: `--thinking` beats every level the harness has saved, including the
// per-model one nothing here can know applies, so the value is written into the
// harness's own settings once and the flag is never handed over. A model whose
// card claims no thinking is offered `off` alone, and the harness clamps this
// to it.
export const CHAT_THINKING_LEVEL = "low";

// Written silently and once, as `silenceStartup` writes its own: a level the
// operator saved through `/thinking` is theirs and is left alone.
export function seedThinkingLevel(settings: {
  getDefaultThinkingLevel(): unknown;
  setDefaultThinkingLevel(level: typeof CHAT_THINKING_LEVEL): void;
}): void {
  try {
    if (settings.getDefaultThinkingLevel() === undefined) settings.setDefaultThinkingLevel(CHAT_THINKING_LEVEL);
  } catch {
    // The chat opens either way.
  }
}
