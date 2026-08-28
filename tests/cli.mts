// node tests/cli.mts

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
for (const line of ["open a chat", "lm <workflow>", "lm stats", "--dry-run", "--which", "LM_MODEL"]) {
  check(`--help covers ${line}`, true, help.out.includes(line));
}
// A description is prose written for the router by whoever wrote the file, so its
// length is not this help to bound: the listing carries names and the detail is
// one command away. A workflow is listed too, and never named in Usage beside
// `lm stats`, which is `lm` itself rather than something this repository ships.
check("the tools are listed as names alone",
  true, /^Available tools:\n  changelog, commit, issue, pr$/m.test(help.out));
check("the workflows have a listing of their own",
  true, /^Available workflows:\n  ship$/m.test(help.out));
check("no description reaches the listing", false, help.out.includes("Conventional Commits"));
check("and it says where the detail is", true, help.out.includes("lm <name> --help"));
check("a workflow is not named in Usage", false, /^  lm ship /m.test(help.out));

// A name in the first position claims the help flag, and what comes back is
// generated from what the file declares: no tool file answers --help itself.
const own = run(LM, ["commit", "--help"]);
check("what it does is the first line, not a label",
  true, own.out.startsWith("Write a Conventional Commits message"));
check("and the usage names it once", true, /^  lm commit \[options\] \[text\]$/m.test(own.out));
check("and exits 0", 0, own.code);
// Which kind it is shows in whether there is a sequence to name.
check("a tool names no sequence", false, own.out.includes("Runs in order:"));
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

// A mistyped option is not a verb name, and the verb list is a set that cannot
// contain it, so answering with that list answers a question nobody asked.
const mistyped = run(LM, ["--hlp"]);
check("a mistyped option exits 2", 2, mistyped.code);
check("and is named back", true, /'--hlp' is not an option of lm/.test(mistyped.err));
check("and is not reported as a missing verb", false, /no such tool/.test(mistyped.err));
check("and the options it could have meant are listed", true, /--list, --which, -h, --help/.test(mistyped.err));

// The capability is a verb's flag, so it goes after the verb exactly like --dry-run
// does and the first-position guard is untouched by it.
const preYes = run(LM, ["--yes", "commit"]);
check("--yes ahead of its verb exits 2", 2, preYes.code);
check("and is named as a misplaced verb flag", true, /A verb takes .*--yes/.test(preYes.err));

const misplaced = run(LM, ["--dry-run"]);
check("a verb flag ahead of its verb exits 2", 2, misplaced.code);
check("and is told where the flag goes", true, /A verb takes --dry-run/.test(misplaced.err));

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
const listed = (out: string) => rows(out).map((r) => r[0]);
const fromProject = (out: string) => rows(out).filter((r) => r[2] === "project").map((r) => r[0]);
const SHIPPED = ["changelog", "commit", "issue", "pr", "ship"];

const plain = runIn(project("plain"), ["--list"]);
check("a project with no tools of its own lists the installation's", SHIPPED, listed(plain.out));
check("and marks nothing as the project's", [], fromProject(plain.out));

const shadowDir = project("shadow", { "commit.sh": refuses("commit", "the project's own commit") });
const shadow = runIn(shadowDir, ["--list"]);
check("a name the project also ships appears once", SHIPPED, listed(shadow.out));
check("and it is the project's description that is printed",
  true, /^commit\tthe project's own commit\tproject$/m.test(shadow.out));
check("and the installation's is gone", false, shadow.out.includes("Conventional Commits"));
check("and only that name is marked", ["commit"], fromProject(shadow.out));

const onlyDir = project("only", { "hello.sh": refuses("hello", "only the project ships this") });
const only = runIn(onlyDir, ["--list"]);
check("a name only the project ships is listed",
  ["changelog", "commit", "hello", "issue", "pr", "ship"], listed(only.out));
check("and marked as the project's", ["hello"], fromProject(only.out));
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
check("the shell runner resolves a verb through the same precedence",
  true, direct.err.includes("hello: the project's own file ran"));
check("and hands back the tool's own refusal", 3, direct.code);
// The listing comes from libexec/lm-verb and the help from bin/lm, each resolving
// the registry for itself, so naming a different set is the drift this catches.
const viaHelp = runIn(onlyDir, ["--help"]).out;
const named = (label: string) => (new RegExp(`^Available ${label}:\\n  (.*)$`, "m").exec(viaHelp)?.[1] ?? "").split(", ");
check("and both runners name the same registry",
  listed(only.out), [...named("tools"), ...named("workflows")].sort());

// Outside a repository there is no project half, so there is nothing to prefer.
const loose = mkdtempSync(join(tmpdir(), "lm-loose-"));
const outside = runIn(loose, ["--list"]);
check("outside a repository the registry is the installation's alone", SHIPPED, listed(outside.out));
check("and nothing is marked there either", [], fromProject(outside.out));

// The variable is the whole registry and not the first of two, which is what
// every fixture that isolates the registry has always relied on.
const pinned = runIn(shadowDir, ["--list"], { LM_TOOLS: join(onlyDir, "tools") });
check("LM_TOOLS is the whole registry", ["hello"], listed(pinned.out));
check("and its entries are not the project's", [], fromProject(pinned.out));
// Dispatch reads the same whole registry: a name the project ships is not in it.
const pinnedRun = runIn(shadowDir, ["commit"], { LM_TOOLS: join(onlyDir, "tools") });
check("and dispatch sees only what the variable names", 2, pinnedRun.code);
check("saying so of a name the project does ship",
  true, pinnedRun.err.includes("no such tool 'commit'"));

// Inside the installation's own repository the project's tools/ is the
// installation's, so the precedence is one directory and nothing shadows.
check("the installation's own repository marks nothing as shadowing",
  [], fromProject(runIn(ROOT, ["--list"]).out));

// A workflow the installation ships names its verbs by name, and a name is
// resolved through the same precedence the listing is.
const workflow = runIn(shadowDir, ["ship", "--here", "--no-stage"]);
check("a workflow's verb resolves to the project's file",
  true, workflow.err.includes("commit: the project's own file ran"));
check("and the installation's verb never ran", false, workflow.err.includes("nothing staged"));

rmSync(scratch, { recursive: true, force: true });
rmSync(loose, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
