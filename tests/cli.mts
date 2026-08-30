// node tests/cli.mts

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const LM = join(ROOT, "bin/lm");
let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${w}\n  got:  ${g}`);
    fail = 1;
  }
}

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd: ROOT, env: { ...process.env, LM_LOG: "" } });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 0 };
}

check("bin holds one command", "lm", readdirSync(join(ROOT, "bin")).join(","));

const help = run(LM, ["--help"]);
check("--help exits 0", 0, help.code);
for (const line of ["open a chat", "lm <verb>", "lm <workflow>", "lm stats", "--dry-run", "--which", "LM_MODEL"]) {
  check(`--help covers ${line}`, true, help.out.includes(line));
}
// A description is prose written for the router by whoever wrote the file, so its
// length is not this help to bound: the listing carries names and the detail is
// one command away. A workflow is listed too, and never named in Usage beside
// `lm stats`, which is `lm` itself rather than something this repository ships.
check("the verbs are listed as names alone",
  true, /^Available verbs:\n  changelog, commit, issue, pr$/m.test(help.out));
check("the workflows have a listing of their own",
  true, /^Available workflows:\n  ship$/m.test(help.out));
check("no description reaches the listing", false, help.out.includes("Conventional Commits"));
check("and it says where the detail is", true, help.out.includes("lm <name> --help"));
check("a workflow is not named in Usage", false, /^  lm ship /m.test(help.out));
// The identifier is optional there, and saying so is the whole difference between
// a flag that reopens the chat the closing block named and one that offers a list.
check("--resume is named as taking an identifier and not needing one",
  true, /^  lm --resume \[id\] +\S/m.test(help.out));

// A name in the first position claims the help flag, and what comes back is
// generated from what the file declares: no tool file answers --help itself.
const own = run(LM, ["commit", "--help"]);
check("what it does is the first line, not a label",
  true, own.out.startsWith("Write a Conventional Commits message"));
check("and the usage names it once", true, /^  lm commit \[options\] \[text\]$/m.test(own.out));
check("and exits 0", 0, own.code);
// Which kind it is shows in whether there is a sequence to name.
check("a verb names no sequence", false, own.out.includes("Runs in order:"));
const flow = run(LM, ["ship", "--help"]);
check("a workflow names the verbs it runs, in order",
  true, /^Runs in order:\n  commit, pr$/m.test(flow.out));
check("and names the flags it declared, under who declared them",
  true, /^Declared by ship:\n  --here, --no-stage$/m.test(flow.out));
check("help goes to stdout, not stderr", "", help.err);

check("-h is the same help", help.out, run(LM, ["-h"]).out);
check("a name claims the flag, so the global help is not what comes back", false, run(LM, ["commit", "--help"]).out === help.out);

const viaDispatch = run(LM, ["--list"]);
const viaVerb = run(join(ROOT, "libexec/lm-verb"), ["--list"]);
check("--list reaches the shell runner", viaVerb.out, viaDispatch.out);

// An emptied LM_LOG is refused by lm-stats before it parses arguments, so a case
// built on a bad argument there would pass for the wrong reason.
const unknown = run(LM, ["nosuch"]);
check("a subcommand's exit status arrives", 2, unknown.code);
check("and its message arrives", true, /no such tool 'nosuch'/.test(unknown.err));

// A leading flag lm does not claim reaches the chat, which keeps no list of the
// harness's own options: one neither of them takes is named back by the parser
// that read it. A launch writes to the harness's directory, so these get a
// scratch one rather than the operator's, and ask for no catalogue.
const agentDir = mkdtempSync(join(tmpdir(), "lm-forwarded-"));
const forwarded = (args: string[]) => {
  const r = spawnSync(LM, args, { encoding: "utf8", cwd: ROOT,
    env: { ...process.env, LM_LOG: "", PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir } });
  return { err: r.stderr ?? "", code: r.status ?? 0 };
};

const mistyped = forwarded(["--hlp"]);
check("a mistyped option is refused rather than opening a chat", 1, mistyped.code);
check("and is named back", true, /Unknown option: --hlp/.test(mistyped.err));
// A mistyped option is not a verb name, and the verb list is a set that cannot
// contain it, so answering with that list answers a question nobody asked.
check("and is not reported as a missing verb", false, /no such tool/.test(mistyped.err));

// The capability is a verb's flag, so it goes after the verb exactly like --dry-run
// does. Neither is the chat's to answer, and the harness that would answer it knows
// of no verb to put it behind, so lm keeps these two and says where they go.
const preYes = forwarded(["--yes", "commit"]);
check("--yes ahead of its verb exits 2", 2, preYes.code);
check("and is told where the flag goes", true, /'--yes' is a verb's option and goes after the verb/.test(preYes.err));
const misplaced = forwarded(["--dry-run"]);
check("a verb flag ahead of its verb exits 2", 2, misplaced.code);
check("and is named while being told", true, /'--dry-run' is a verb's option and goes after the verb/.test(misplaced.err));

// `--resume` is this program's word for reopening a chat and the harness spells
// the two halves apart, so an identifier after it is handed over as `--session`
// and only the bare flag reaches the harness's own picker. A name no session
// carries is what says which of the two the harness was asked for, and it is
// answered before a provider is resolved, so the run costs no model call.
// Nothing here reaches a model: the provider is refused, and the session is
// looked up before it. What the harness looked up is read back rather than the
// exit status, because the picker and a name that finds nothing both leave 0.
const OFFLINE = ["-p", "--provider", "nosuchprov"];
const sought = (err: string) => /No session found matching '(.*)'/.exec(err)?.[1];
const soughtBy = (args: string[]) => sought(forwarded([...OFFLINE, ...args]).err);
check("an identifier after --resume is the session the harness looks for",
  "nosuchsession", soughtBy(["--resume", "nosuchsession"]));
check("and -r is the same word", "nosuchsession", soughtBy(["-r", "nosuchsession"]));
// Naming no session is not the same as offering the list: an empty name is one
// the harness reads as no session at all and opens a new chat on, so the picker
// it draws is what says which of the two it was asked for.
const bare = forwarded([...OFFLINE, "--resume"]).err;
check("with nothing after it, it names no session", undefined, sought(bare));
check("and reaches the harness's own list instead", true, /Resume Session/.test(bare));
check("and a flag after it is a flag rather than the name it wanted",
  undefined, soughtBy(["--resume", "--continue"]));
// `lm --help` promises everything after `--` is text, dashes and all. The words
// the chat was handed are read back off the harness's own JSON mode, because the
// harness reads them as text either way and no session lookup would notice one of
// them rewritten. Its own directory, to turn the retries off there: the endpoint
// points nowhere, and the words are printed before the request that fails.
const textDir = mkdtempSync(join(tmpdir(), "lm-text-"));
writeFileSync(join(textDir, "settings.json"), '{"retry":{"enabled":false,"maxRetries":0}}');
const asText = spawnSync(LM, ["-p", "--mode", "json", "--model", "nosuchmodel", "--", "--resume", "zzzmarker"], {
  encoding: "utf8", cwd: ROOT,
  env: { ...process.env, LM_LOG: "", PI_OFFLINE: "1", LM_OLLAMA: "http://127.0.0.1:1", PI_CODING_AGENT_DIR: textDir },
});
const asked = [...(asText.stdout ?? "").matchAll(/"role":"user","content":\[\{"type":"text","text":"([^"]*)"/g)];
check("everything after -- reaches the chat as the words that were typed",
  ["--resume", "zzzmarker"], [...new Set(asked.map((m) => m[1]))]);
rmSync(textDir, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });

const stats = spawnSync(LM, ["stats"], { encoding: "utf8", cwd: ROOT });
check("stats reaches the run log", true, /^verb\s+runs\s+clean/m.test(stats.stdout ?? ""));

// Which verbs a run offers depends on where it stands, so each fixture below is a
// repository of its own: the project half of the registry is read off
// `git rev-parse --show-toplevel` in the working directory.
const scratch = mkdtempSync(join(tmpdir(), "lm-registry-"));

// A tool whose collect refuses names itself while doing so, because the exit
// status alone cannot say which of two files with the same name answered.
const refuses = (n: string, d: string) =>
  `name="${n}"\ndescription="${d}"\ncollect() { echo "${n}: the project's own file ran" >&2; return 3; }\n`;

function project(name: string, tools: Record<string, string> = {}): string {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  if (Object.keys(tools).length > 0) mkdirSync(join(dir, "tools"));
  for (const [file, body] of Object.entries(tools)) writeFileSync(join(dir, "tools", file), body);
  return dir;
}

function runIn(cwd: string, args: string[], extra: Record<string, string> = {}, bin = LM) {
  const env: Record<string, string | undefined> = { ...process.env, LM_LOG: "", ...extra };
  // Deleted rather than emptied: the fixture must read what an operator with
  // nothing set reads, and an empty value is a value.
  if (!("LM_TOOLS" in extra)) delete env.LM_TOOLS;
  const r = spawnSync(bin, args, { encoding: "utf8", cwd, env: env as NodeJS.ProcessEnv });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 0 };
}

const rows = (out: string) => out.trim().split("\n").map((l) => l.split("\t"));
const listed = (out: string) => (out.trim() === "" ? [] : rows(out).map((r) => r[0]));
const SHIPPED = ["changelog", "commit", "issue", "pr", "ship"];

// The registry is the project's own tools/ and nothing else, so a project that
// ships none has no verbs at all rather than the installation's.
const plainDir = project("plain");
const plain = runIn(plainDir, ["--list"]);
check("a project with no tools of its own lists nothing", [], listed(plain.out));
check("and says nothing at all while doing it", "", plain.out);
check("and the listing still exits 0", 0, plain.code);
// A heading with nothing under it is not printed, for either kind, and nothing
// stands in for the section that is gone.
const plainHelp = runIn(plainDir, ["--help"]);
check("and --help names no verbs there", false, plainHelp.out.includes("Available verbs:"));
check("and no workflows either", false, plainHelp.out.includes("Available workflows:"));
check("and does not send the reader to a description that is not there",
  false, plainHelp.out.includes("lm <name> --help"));
check("while still printing the rest of the help", true, plainHelp.out.includes("Environment:"));
// The refusal keeps its exit code and loses the list it has nothing to fill.
const plainRun = runIn(plainDir, ["commit"]);
check("a verb the registry does not hold exits 2 there", 2, plainRun.code);
check("and the empty list is not printed under it",
  "lm: no such tool 'commit'.\n", plainRun.err);
const plainDirect = runIn(plainDir, ["commit"], {}, join(ROOT, "libexec/lm-verb"));
check("and the shell runner answers the same way", "lm: no such tool 'commit'.\n", plainDirect.err);
check("with the same exit code", 2, plainDirect.code);
// Its own usage drops the section too: bare lm-verb prints usage and exits 2.
const plainUsage = runIn(plainDir, [], {}, join(ROOT, "libexec/lm-verb"));
check("and its usage names no commands", false, plainUsage.err.includes("Commands:"));

const shadowDir = project("shadow", { "commit.sh": refuses("commit", "the project's own commit") });
const shadow = runIn(shadowDir, ["--list"]);
check("the project's own tools are the whole registry", ["commit"], listed(shadow.out));
check("and it is the project's description that is printed",
  true, /^commit\tthe project's own commit$/m.test(shadow.out));
check("and the installation's is gone", false, shadow.out.includes("Conventional Commits"));

const onlyDir = project("only", { "hello.sh": refuses("hello", "only the project ships this") });
const only = runIn(onlyDir, ["--list"]);
check("a name only the project ships is listed", ["hello"], listed(only.out));
check("and the installation ships nothing into it",
  false, SHIPPED.some((n) => listed(only.out).includes(n)));
// Listed is not reachable. `--list` is the shell runner's answer and dispatch is
// the Node runner's, so a name that appears in one and runs from the other is
// what says the two resolve the same registry.
const ran = runIn(onlyDir, ["hello"]);
check("and the run arrives in the project's own file",
  true, ran.err.includes("hello: the project's own file ran"));
check("carrying the tool's own refusal", 3, ran.code);
check("and its help is generated from the project's declaration",
  true, runIn(onlyDir, ["hello", "--help"]).out.startsWith("only the project ships this"));
// The shell runner resolves a verb for itself when it is invoked directly, which
// is the one path bin/lm does not go through.
const direct = runIn(onlyDir, ["hello"], {}, join(ROOT, "libexec/lm-verb"));
check("the shell runner resolves a verb through the same registry",
  true, direct.err.includes("hello: the project's own file ran"));
check("and hands back the tool's own refusal", 3, direct.code);
// The listing comes from libexec/lm-verb and the help from bin/lm, each resolving
// the registry for itself, so naming a different set is the drift this catches.
const viaHelp = runIn(onlyDir, ["--help"]).out;
const named = (label: string) =>
  (new RegExp(`^Available ${label}:\\n  (.*)$`, "m").exec(viaHelp)?.[1] ?? "").split(", ").filter(Boolean);
check("and both runners name the same registry",
  listed(only.out), [...named("verbs"), ...named("workflows")].sort());

// Outside a repository there is no `git rev-parse --show-toplevel` to read, so
// there is no registry at all.
const loose = mkdtempSync(join(tmpdir(), "lm-loose-"));
const outside = runIn(loose, ["--list"]);
check("outside a repository the registry is empty", [], listed(outside.out));

// The variable is the whole registry, which is what every fixture that isolates
// the registry has always relied on.
const pinned = runIn(shadowDir, ["--list"], { LM_TOOLS: join(onlyDir, "tools") });
check("LM_TOOLS is the whole registry", ["hello"], listed(pinned.out));
// Dispatch reads the same whole registry: a name the project ships is not in it.
const pinnedRun = runIn(shadowDir, ["commit"], { LM_TOOLS: join(onlyDir, "tools") });
check("and dispatch sees only what the variable names", 2, pinnedRun.code);
check("saying so of a name the project does ship",
  true, pinnedRun.err.includes("no such tool 'commit'"));

// This repository is a project like any other, and its tools/ is what it gets.
check("the installation's own repository is served by its own tools/",
  SHIPPED, listed(runIn(ROOT, ["--list"]).out));

// A workflow names its verbs by name, and a name is resolved through the same
// registry the listing is.
const flowDir = project("flow", { "commit.sh": refuses("commit", "the project's own commit") });
copyFileSync(join(ROOT, "tools/ship.sh"), join(flowDir, "tools/ship.sh"));
const workflow = runIn(flowDir, ["ship", "--here", "--no-stage"]);
check("a workflow's verb resolves to the project's file",
  true, workflow.err.includes("commit: the project's own file ran"));
check("and the installation's verb never ran", false, workflow.err.includes("nothing staged"));

rmSync(scratch, { recursive: true, force: true });
rmSync(loose, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
