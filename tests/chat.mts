// node tests/chat.mts
//
// What the chat is offered. The registration is a walk over the registry
// directory, so the property under test is that nothing here knows the names:
// a fifth tool file has to be offered without a file being edited.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerVerbs } from "../src/chat.mts";
import { list, meta } from "../src/registry.mts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TOOLS = join(ROOT, "tools");
let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = typeof want === "string" ? want : JSON.stringify(want);
  const g = typeof got === "string" ? got : JSON.stringify(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

function collect(dir: string) {
  const tools: any[] = [];
  const names = registerVerbs({ registerTool: (t: any) => tools.push(t) }, dir);
  return { tools, names };
}

const repo = collect(TOOLS);
check("every tool file in the registry is offered to the chat",
  list(TOOLS).map((f) => meta(f).name), repo.names);
check("and each is offered under its own name",
  repo.names, repo.tools.map((t) => t.name));
check("with the description the router already uses",
  list(TOOLS).map((f) => meta(f).description), repo.tools.map((t) => t.description));
check("and the same one in the system prompt's tool list",
  repo.tools.map((t) => t.description), repo.tools.map((t) => t.promptSnippet));

// The chat's model supplies what a human types and nothing else: the verb still
// writes its own prompt and asks the model itself.
const params = repo.tools[0].parameters;
check("a verb takes the arguments a human takes", ["text", "dry_run"], Object.keys(params.properties));
check("and no field of its own answer", "undefined", String(params.required));

const work = mkdtempSync(join(tmpdir(), "lm-chat-"));
writeFileSync(join(work, "fifth.sh"), [
  'name="fifth"',
  'description="a tool nobody edited a file for"',
  "collect() { echo hi; }",
  "schema() { echo '{}'; }",
  "validate() { cat >/dev/null; }",
  "render() { cat; }",
  "",
].join("\n"));
check("a tool file dropped into the registry is offered too", ["fifth"], collect(work).names);
rmSync(work, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
