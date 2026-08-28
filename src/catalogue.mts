import { contextWindow, endpoint, providerConfig } from "./provider.mts";

type Model = ReturnType<typeof providerConfig>["models"][number];

// What a model declares as its window: the service bounds every model it loads,
// and a card smaller than that bounds itself. The service's side of it is what
// `LM_CTX` says, so an operator running a smaller service is believed here too.
// A card under the floor in `docs/verbs.md` arms compaction on every turn and
// summarises nothing, and this cannot fix that: the other answer is declaring a
// window the model does not have.
const windowFor = (cardTokens: number | undefined) => {
  const served = contextWindow();
  return Math.min(cardTokens && cardTokens > 0 ? cardTokens : served, served);
};

async function json(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${endpoint()}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
}

// The card's own context length, under whichever key its architecture uses:
// `qwen35.context_length` for one model and `gemma4.context_length` for another,
// so the key is found by its suffix rather than named.
async function card(name: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    const shown = await json("/api/show", { model: name }, signal);
    const info = shown?.model_info ?? {};
    const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
    return key ? Number(info[key]) : undefined;
  } catch {
    return undefined;
  }
}

// Every model ollama has, for the chat's selector. Returns undefined rather than
// an empty list when the machine cannot be asked: the harness replaces the
// offered list only when this returns one, so undefined leaves the single entry
// the session opened on and an empty array would leave nothing to select.
// `allowNetwork` is the harness's own offline switch and is `PI_OFFLINE === undefined`,
// so honouring it costs a catalogue only where the operator asked for no fetching.
export async function catalogue(
  context: { allowNetwork?: boolean; signal?: AbortSignal } = {},
): Promise<Model[] | undefined> {
  if (context.allowNetwork === false) return undefined;
  const signal = context.signal;
  const template = providerConfig().models[0];
  let names: string[];
  try {
    const tags = await json("/api/tags", undefined, signal);
    names = (tags?.models ?? []).map((m: any) => m.name).filter((n: unknown) => typeof n === "string");
  } catch {
    return undefined;
  }
  if (names.length === 0) return undefined;

  const cards = await Promise.all(names.map((n) => card(n, signal)));
  return names.map((name, i) => ({
    ...template,
    id: name,
    name,
    contextWindow: windowFor(cards[i]),
  }));
}
