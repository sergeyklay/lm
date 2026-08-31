import { modelId } from "./provider.mts";

type SavedChoice = { getDefaultProvider(): unknown; getDefaultModel(): unknown };

const savedInPi = (settings: SavedChoice) =>
  Boolean(settings.getDefaultProvider() && settings.getDefaultModel());

// The provider the chat registers, and the one a launch with nothing remembered
// opens under. It travels beside the model id everywhere the two are compared,
// because two providers can serve one name and the harness saves them together.
const CHAT_PROVIDER = "ollama";

// What the chat opens on, which is not what a verb asks. The chat remembers the
// model it was last on, and `findInitialModel` in the harness reads that memory
// whenever no `--model` reaches `main()` ahead of it, so the flags are handed
// over only when there is nothing remembered. `LM_MODEL` names the verb's model
// and is the one way to aim a single launch somewhere else, so it is handed over
// whenever it is set and overrules the memory for that launch alone.
export function initialSelection(settings: SavedChoice): string[] {
  const remembered = process.env.LM_MODEL === undefined && savedInPi(settings);
  return remembered ? [] : ["--provider", CHAT_PROVIDER, "--model", modelId()];
}

// The level a chat opens on when nothing is remembered for the model it opens
// on, and a seed rather than an override: `--thinking` beats every level the
// harness has saved, so the value is written into the harness's own settings
// once and the flag is never handed over. The harness prefers the level
// remembered for the model in force over this one, at launch and on every
// switch, so seeding it can never overrule a remembered level. A model whose
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
