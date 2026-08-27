// node tests/window.mts
//
// What the declared window buys, driven through the harness's own compaction
// rather than through a live session: where the trigger arms, and whether any
// history is left to summarise once it does. Both are functions of one number.
// The trigger stands at `contextWindow - reserveTokens` while the compactor
// insists on keeping `keepRecentTokens` whole, so a window below the sum of
// those two arms over a history it cannot cut, fires on every turn and
// summarises nothing. The suite carries that case as its own control.

import { readFileSync } from "node:fs";
import { shouldCompact, findCutPoint, estimateTokens, DEFAULT_COMPACTION_SETTINGS } from "@earendil-works/pi-coding-agent";
import { SERVED_CONTEXT_TOKENS, contextWindow } from "../src/provider.mts";

let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

const { reserveTokens, keepRecentTokens } = DEFAULT_COMPACTION_SETTINGS;

// A thousand tokens per entry, alternating roles so every entry is a valid cut
// point. `estimateTokens` is the harness's own estimator: four characters a token.
const TOKENS_PER_ENTRY = 1000;
const entry = (i: number) => ({
  type: "message",
  message: {
    role: i % 2 ? "assistant" : "user",
    content: [{ type: "text", text: "x".repeat(TOKENS_PER_ENTRY * 4) }],
  },
});
const conversation = (tokens: number) =>
  Array.from({ length: Math.ceil(tokens / TOKENS_PER_ENTRY) }, (_, i) => entry(i));

check("the estimator agrees about one entry", TOKENS_PER_ENTRY, estimateTokens(entry(0).message as any));

// The window this project declares is what the service serves, so the number is
// the same on both registrations and nothing else reads it.
check("the declared window is one number", SERVED_CONTEXT_TOKENS, contextWindow());

// The two runners never meet at runtime, so nothing but this compares their
// defaults, and a shell verb asking for a window the Node runner no longer
// declares reloads the model at a size nothing else uses.
const shell = readFileSync(new URL("../libexec/lm-verb", import.meta.url), "utf8");
const shellDefault = /LM_CTX:=([0-9]+)/.exec(shell)?.[1];
check("the shell runner declares the same window", String(SERVED_CONTEXT_TOKENS), shellDefault);

const trigger = SERVED_CONTEXT_TOKENS - reserveTokens;
check("the trigger holds at the reserve", false, shouldCompact(trigger, SERVED_CONTEXT_TOKENS, DEFAULT_COMPACTION_SETTINGS));
check("and arms one token past it", true, shouldCompact(trigger + 1, SERVED_CONTEXT_TOKENS, DEFAULT_COMPACTION_SETTINGS));

// The invariant the number has to satisfy: the trigger must arm over more history
// than the compactor keeps, or the first compaction has nothing to hand a summary.
check("the trigger arms above what the compactor keeps", true, trigger > keepRecentTokens);

const armed = conversation(trigger + 1);
const cut = findCutPoint(armed as any, 0, armed.length, keepRecentTokens);
check("so the cut moves off the first message", true, cut.firstKeptEntryIndex > 0);
check("and keeps the recent budget rather than the conversation",
      Math.ceil(keepRecentTokens / TOKENS_PER_ENTRY), armed.length - cut.firstKeptEntryIndex);

// The control, and the reason the number matters: 32 768 arms the trigger at
// 16 384, which is under the 20 000 the compactor keeps, so the cut cannot move
// and `prepareCompaction` returns undefined on a conversation that just triggered.
const narrow = 32768;
const narrowTrigger = narrow - reserveTokens;
check("a window under reserve plus keep still arms", true, shouldCompact(narrowTrigger + 1, narrow, DEFAULT_COMPACTION_SETTINGS));
const starved = conversation(narrowTrigger + 1);
check("and then has nothing to cut", 0, findCutPoint(starved as any, 0, starved.length, keepRecentTokens).firstKeptEntryIndex);

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
