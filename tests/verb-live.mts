// LM_LIVE=1 node tests/verb-live.mts
//
// Calls the real model, so it is gated and not part of the default suites.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerb } from "../src/verb.mts";

if (process.env.LM_LIVE !== "1") {
  console.log("skipped: set LM_LIVE=1 to call the model");
  process.exit(0);
}

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

// The fixture runs are not this repository's history, and one log spans every
// repository: without this they land in `~/.lm/runs.jsonl` under a temporary
// directory's name and `lm stats --all` counts them.
process.env.LM_LOG = "";

const work = mkdtempSync(join(tmpdir(), "lm-verb-"));
const tools = join(work, "tools");
mkdirSync(tools, { recursive: true });

function tool(name: string, alwaysReject: boolean) {
  writeFileSync(join(tools, `${name}.sh`), [
    `name="${name}"`,
    'description="emit one changelog bullet"',
    'collect() { echo "Write one changelog bullet for a change that renames a flag."; }',
    'schema() { echo \'{"type":"object","properties":{"section":{"type":"string","enum":["Added","Fixed","Changed"]},"bullet":{"type":"string"}},"required":["section","bullet"]}\'; }',
    alwaysReject
      ? 'validate() { cat >/dev/null; echo "bullet must start with the word Refuse"; }'
      : "validate() { cat >/dev/null; }",
    `render() { jq -r '"\\(.section): \\(.bullet)"'; }`,
    "apply() { cat >/dev/null; }",
    "",
  ].join("\n"));
  return join(tools, `${name}.sh`);
}

const rejects = tool("rejects", true);
const accepts = tool("accepts", false);

process.chdir(work);

// The call count is the assertion, not the exit code. 5.1 measured that removing
// the retry leaves the code at 4 while the retry is gone.
const bad = await runVerb(rejects, [], {});
check("a validator that never passes exits 4", 4, bad.code);
check("and costs exactly two model calls", 2, bad.calls);
check("and called the tool twice", 2, bad.attempts);

const good = await runVerb(accepts, [], {});
check("a clean answer exits 0", 0, good.code);
check("and costs exactly one model call", 1, good.calls);
check("and called the tool once", 1, good.attempts);

// LM_CTX below the harness's own 4096-token safety margin clamps the answer
// budget to one token whatever the prompt costs, so the model is cut off on its
// first token and the case does not depend on how long an answer it wanted.
process.env.LM_CTX = "4096";
const cut = await runVerb(accepts, [], {});
check("an answer cut off by the budget exits 5", 5, cut.code);
check("and costs exactly one model call", 1, cut.calls);
check("and never reached the tool", 0, cut.attempts);
delete process.env.LM_CTX;

process.chdir(ROOT);
// Through the command, because the exit code alone cannot tell a cut-off answer
// from one that never arrived: both are 5, and only the message says which.
const cutCli = spawnSync(join(ROOT, "bin/lm"), ["accepts"], {
  encoding: "utf8",
  cwd: work,
  env: { ...process.env, LM_TOOLS: tools, LM_LOG: "", LM_CTX: "4096" },
  timeout: 600_000,
});
check("the command exits 5 on a cut-off answer", 5, cutCli.status);
check("and says the budget is why", true, /hit the token budget/.test(cutCli.stderr ?? ""));
check("and renders nothing", "", cutCli.stdout ?? "");

const cli = spawnSync(join(ROOT, "bin/lm"), ["accepts", "--dry-run"], {
  encoding: "utf8",
  cwd: work,
  env: { ...process.env, LM_TOOLS: tools, LM_LOG: "" },
  timeout: 600_000,
});
check("the command renders the answer", true, /^(Added|Fixed|Changed): \S/m.test(cli.stdout ?? ""));
check("and says the side effect was skipped", true, /--dry-run: no side effect/.test(cli.stdout ?? ""));
check("and exits 0", 0, cli.status);

// The chat's half: a session is asked for the work and runs the registered verb
// rather than describing it. Print mode has no dialog, so `ctx.ui.confirm`
// refuses, and a refusal is the case worth having on the real model: it proves
// the verb ran, that the question reached the chat, and that nothing was
// applied when the answer was no. The run log is the witness that it ran.
writeFileSync(join(tools, "applies.sh"), [
  'name="applies"',
  'description="emit one changelog bullet and write it to a file"',
  'collect() { echo "Write one changelog bullet for a change that renames a flag."; }',
  'schema() { echo \'{"type":"object","properties":{"bullet":{"type":"string"}},"required":["bullet"]}\'; }',
  "validate() { cat >/dev/null; }",
  "render() { jq -r .bullet; }",
  'apply() { local j; j=$(cat); confirm "write it? [y/N]"; printf %s "$j" > applied.txt; }',
  "",
].join("\n"));

const chatLog = join(work, "chat-runs.jsonl");
process.chdir(work);
process.env.LM_TOOLS = tools;
process.env.LM_LOG = chatLog;
const { main } = await import("@earendil-works/pi-coding-agent");
const { providerConfig, modelId } = await import("../src/provider.mts");
const { registerVerbs } = await import("../src/chat.mts");
await main(["--provider", "ollama", "--model", modelId(), "-p", "Run the applies tool. Pass no text."], {
  extensionFactories: [
    {
      name: "lm",
      factory: (pi: any) => {
        pi.registerProvider("ollama", providerConfig());
        registerVerbs(pi, tools);
      },
    },
  ],
});
process.env.LM_LOG = "";
process.chdir(ROOT);

const records = existsSync(chatLog)
  ? readFileSync(chatLog, "utf8").trim().split("\n").filter((l) => l).map((l) => JSON.parse(l))
  : [];
check("the chat ran the registered verb rather than answering about it", "applies", records[0]?.verb);
check("and it cost the verb's own model call", 1, records[0]?.calls);
check("and the refused confirmation exited 7", 7, records[0]?.exit);
check("and nothing was applied", false, existsSync(join(work, "applied.txt")));

// The verb layer is advisory inside the chat, because the harness's own shell is in
// the same session and can do a verb's work beside it. docs/verbs.md says so under
// `## Exit codes`, and these two arms are what make the sentence true rather than
// plausible: with the shell, HEAD moves without a verb applying anything; with the
// shell taken away, the same request stops at the verb and its record is the only
// trace. Both arms are driven through bin/lm, because the entry point is part of
// what is being reported.
// What is asserted is the capability, not the model's appetite for it. Asked plainly
// to commit, this model reached for the shell in 3 of 4 runs measured 2026-08-27
// against pi 0.84.3, ollama 0.32.15 and qwen3.8:27b; that frequency is a measurement
// in docs/verbs.md and would be a flake as an assertion.
const page = readFileSync(join(ROOT, "docs/verbs.md"), "utf8");
check("the page says a verb inside the chat is a request",
  true, /a request the model may fulfil another way/.test(page));

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "lm-shell-"));
  const git = (...args: string[]) =>
    (spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout ?? "").trim();
  git("init", "-q", "-b", "main", ".");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-qm", "chore: seed");
  writeFileSync(join(repo, "a.txt"), "two\n");
  return { repo, git, head0: git("rev-parse", "HEAD"), log: join(repo, "runs.jsonl") };
}

function session(f: ReturnType<typeof fixture>, prompt: string, extra: string[]) {
  spawnSync(join(ROOT, "bin/lm"), ["chat", "-p", prompt, ...extra], {
    cwd: f.repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LM_LOG: f.log, LM_TOOLS: join(ROOT, "tools") },
  });
  return existsSync(f.log)
    ? readFileSync(f.log, "utf8").trim().split("\n").filter((l) => l).map((l) => JSON.parse(l))
    : [];
}

const withShell = fixture();
const shellRuns = session(withShell, "Commit the change using git directly rather than the commit tool.", []);
check("the shell moves HEAD with no verb behind it",
  true, withShell.git("rev-parse", "HEAD") !== withShell.head0);
check("and nothing the log holds claims it",
  true, shellRuns.every((r) => r.head_moved === false && r.exit !== 0));
rmSync(withShell.repo, { recursive: true, force: true });

const noShell = fixture();
const verbRuns = session(noShell, "commit the change", ["--exclude-tools", "bash"]);
check("without the shell the request reaches the verb", true, verbRuns.length > 0);
check("and stops there, HEAD where it started",
  noShell.head0, noShell.git("rev-parse", "HEAD"));
check("and every record it left is non-zero", true, verbRuns.every((r) => r.exit !== 0));
rmSync(noShell.repo, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
