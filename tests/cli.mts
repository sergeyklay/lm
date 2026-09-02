// node tests/cli.mts

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  true, /^Available verbs:\n  changelog, commit, issue, pr, release$/m.test(help.out));
check("the workflows have a listing of their own",
  true, /^Available workflows:\n  ship$/m.test(help.out));
check("no description reaches the listing", false, help.out.includes("Conventional Commits"));
check("and it says where the detail is", true, help.out.includes("lm <name> --help"));
check("a workflow is not named in Usage", false, /^  lm ship /m.test(help.out));
// The identifier is optional there, and saying so is the whole difference between
// a flag that reopens the chat the closing block named and one that offers a list.
check("--resume is named as taking an identifier and not needing one",
  true, /^  lm --resume \[id\] +\S/m.test(help.out));
// `lm` reads this one itself: typing it silences the line a session with no
// dialog writes, so both spellings belong in the help that documents them.
check("-p is named in Usage in both spellings, with the text it may carry",
  true, /^  lm -p, --print \[text\] +answer once and exit, without the chat$/m.test(help.out));
// Skills load by default and in every mode, which is this program's own doing
// rather than the harness's, so the switch that turns them off is this program's
// help to carry, and the two directories they come from with it.
check("--no-skills is named in the options, in both spellings",
  true, /^  --no-skills, -ns +load no skills at all this session$/m.test(help.out));
check("and the flag that names one path of its own is beside it",
  true, /^  --skill <path> +\S/m.test(help.out));
// Switching MCP off is this program's own flag rather than a word passed
// through, so the help that documents what `lm` takes is where it is named.
check("--disable-mcp is named in the options",
  true, /^  --disable-mcp +\S/m.test(help.out));

// The help lists what can be typed on the command line and what can be set in
// the environment, and nothing else. Where a file is looked for is `docs/`, and
// what exists inside the chat belongs to the chat, which has a `/help` of its
// own: a help that grows either is documentation printed at the wrong moment.
const helpRows = help.out.split("\n").filter((l) => /^ {2}\S.* {2,}\S/.test(l)).map((l) => l.trim().split(/ {2,}/)[0]);
check("every described row names something typeable or settable",
  [], helpRows.filter((r) => !/^(lm\b|-|LM_)/.test(r)));
check("and none of them is a slash command, which belongs to the chat's own /help",
  [], helpRows.filter((r) => r.startsWith("/")));
check("no heading documents where a file is looked for",
  [], help.out.split("\n").filter((l) => /^(Skills|MCP servers):$/.test(l)));
check("and no directory of the operator's is named", false, /~\//.test(help.out));

// The whole launch under that flag, stopped at the harness's own version so
// nothing reaches the model. The flag is `lm`'s own and is taken out of what
// goes over: the harness files a `--flag` it does not know under the extension
// flags, swallows the word after it and then refuses the session by name.
const away = mkdtempSync(join(tmpdir(), "lm-home-"));
const noMcp = spawnSync(LM, ["--disable-mcp", "--version"], {
  encoding: "utf8", cwd: ROOT, input: "",
  env: { ...process.env, HOME: away, PI_OFFLINE: "1", LM_LOG: "" },
});
check("a launch with MCP switched off gets through to the harness", 0, noMcp.status);
check("with nothing said on the way", "", noMcp.stderr ?? "");
// Forwarded, the flag would reach the harness's own parser and the session
// would be refused by name. This is the whole launch through to the request,
// aimed at a port nothing listens on so that what answers is the ollama that is
// not there rather than a model.
const printed = spawnSync(LM, ["--disable-mcp", "-p", "x"], {
  encoding: "utf8", cwd: ROOT, input: "",
  env: { ...process.env, HOME: away, PI_OFFLINE: "1", LM_LOG: "", LM_OLLAMA: "http://127.0.0.1:1" },
});
const said = `${printed.stdout ?? ""}${printed.stderr ?? ""}`;
check("and the harness is never handed the flag to parse", false, /disable-mcp/.test(said));
check("the launch getting as far as the ollama that is not there", true, /Connection/i.test(said));
rmSync(away, { recursive: true, force: true });

// A name in the first position claims the help flag, and what comes back is
// generated from what the file declares: no tool file answers --help itself.
const own = run(LM, ["commit", "--help"]);
check("what it does is the first line, not a label",
  true, own.out.startsWith("Split the uncommitted changes into logical commits"));
check("and the usage names it once", true, /^  lm commit \[options\] \[text\]$/m.test(own.out));
check("and exits 0", 0, own.code);
// Which kind it is shows in whether there is a sequence to name.
check("a verb names no sequence", false, own.out.includes("Runs in order:"));
// A verb declaring a flag of its own is what `commit` made possible, and the
// help is generated from the declaration rather than written beside it.
check("a verb names the flag it declared, under its own name",
  true, /^Declared by commit:\n  --no-stage$/m.test(own.out));
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

// `.agents/skills` in a repository and `~/.agents/skills` at home are the two
// directories the convention names. The harness reads both, and gates the first
// on a trust question a session with no dialog has nobody to put, so without an
// answer of lm's own the whole project tier disappears in exactly the modes a
// script runs in. Each mode below is asked what it actually loaded, by a probe
// extension that reads it off the harness and closes the session where it opens:
// the endpoint points nowhere and nothing here asks a model anything.
const skillRoot = mkdtempSync(join(tmpdir(), "lm-skills-"));
const skillProbe = join(skillRoot, "probe.mjs");
const skillOut = join(skillRoot, "loaded.json");
const skillHome = join(skillRoot, "home");
const skillRepo = join(skillRoot, "repo");

function plantSkill(dir: string, name: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: A fixture skill, which does nothing at all.\n---\n\nNothing.\n`);
}
plantSkill(join(skillRepo, ".agents", "skills"), "fixproject");
plantSkill(join(skillHome, ".agents", "skills"), "fixuser");
plantSkill(join(skillRoot, "named"), "fixpath");
mkdirSync(join(skillRoot, "agent"), { recursive: true });
spawnSync("git", ["init", "-q", "."], { cwd: skillRepo });
writeFileSync(skillProbe, [
  'import { writeFileSync } from "node:fs";',
  "export default function (pi) {",
  '  pi.on("session_start", (_event, ctx) => {',
  '    const skills = pi.getCommands().filter((c) => c.source === "skill");',
  `    writeFileSync(${JSON.stringify(skillOut)}, JSON.stringify(skills.map((c) => [c.name, c.sourceInfo?.scope])));`,
  "    ctx.shutdown();",
  "  });",
  "}",
].join("\n"));

// The interpreter rather than the shebang: the fixture home is not the
// operator's, and a version manager that reads its file out of $HOME finds
// nothing there and refuses to run anything at all.
function loadedSkills(args: string[]): string[] {
  rmSync(skillOut, { force: true });
  spawnSync(process.execPath, [LM, ...args, "-e", skillProbe], {
    cwd: skillRepo, stdio: "ignore",
    env: { ...process.env, LM_LOG: "", PI_OFFLINE: "1", LM_OLLAMA: "http://127.0.0.1:1",
      HOME: skillHome, PI_CODING_AGENT_DIR: join(skillRoot, "agent") },
  });
  const loaded: Array<[string, string]> = existsSync(skillOut) ? JSON.parse(readFileSync(skillOut, "utf8")) : [];
  return loaded.map(([name, scope]) => `${name} ${scope}`).sort();
}

const BOTH_TIERS = ["skill:fixproject project", "skill:fixuser user"];
check("a launch naming no mode loads both tiers", BOTH_TIERS, loadedSkills([]));
check("and -p loads both, where the harness's own default drops the project's",
  BOTH_TIERS, loadedSkills(["-p"]));
check("and --mode json loads both", BOTH_TIERS, loadedSkills(["--mode", "json"]));
check("and --mode rpc loads both", BOTH_TIERS, loadedSkills(["--mode", "rpc"]));
// The control the cases above need: they read what the session loaded rather
// than what the fixture holds, so switching the loading off has to empty them.
check("--no-skills loads none of them", [], loadedSkills(["-p", "--no-skills"]));
check("and -ns is the same word", [], loadedSkills(["-p", "-ns"]));
check("and it empties the chat's own mode too", [], loadedSkills(["--no-skills"]));
// The harness's own refusal is still a refusal: it is read before any of this
// and drops the project's half while leaving the operator's own alone.
check("--no-approve drops the project tier and keeps the user's",
  ["skill:fixuser user"], loadedSkills(["-p", "--no-approve"]));
// A path named on the command line is neither tier, and the harness keeps it
// through the flag that drops the two.
check("--skill loads one more, from a path of its own",
  [...BOTH_TIERS, "skill:fixpath temporary"].sort(), loadedSkills(["-p", "--skill", join(skillRoot, "named")]));
check("and it survives --no-skills, which is the harness's own word on it",
  ["skill:fixpath temporary"], loadedSkills(["-p", "--no-skills", "--skill", join(skillRoot, "named")]));
rmSync(skillRoot, { recursive: true, force: true });

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
const SHIPPED = ["changelog", "commit", "issue", "pr", "release", "ship"];

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

// A tool that needs lm's own tree is asking the runner where lm is installed, and
// the file it is asking from sits in the project's tools/ rather than there. Each
// runner resolves it for itself, so a tool answered by one and not the other is
// the same drift the registry group above catches. The declaration is read at
// source time, so the answer comes back in the description each runner prints:
// the listing is the shell runner's and the help is the Node runner's.
const installDir = project("install", {
  "probe.sh": 'name="probe"\ndescription="lm is installed at ${LM_INSTALL:-nowhere}"\ncollect() { :; }\n',
});
const shellSaid = runIn(installDir, ["--list"], {}, join(ROOT, "libexec/lm-verb"));
check("the shell runner tells a tool where lm is installed",
  `probe\tlm is installed at ${ROOT}`, shellSaid.out.trim());
const nodeSaid = runIn(installDir, ["probe", "--help"]);
// The description is wrapped as a paragraph there, so the wrap is undone rather
// than the case being pinned to a path short enough not to trigger it.
check("and the Node runner answers with the same directory",
  `lm is installed at ${ROOT}`, nodeSaid.out.split("\n\nUsage:")[0].split(/\s+/).join(" "));

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

// A registry that cannot be read is not a registry holding nothing, and the
// difference is the one variable this project asks the operator to set. Every
// entry point refuses it in the same words, and the shell runner is one of them
// because `--list` is its answer and dispatch is the Node runner's.
const missing = join(scratch, "no-such-registry");
const REFUSAL = `lm: LM_TOOLS names ${missing}, which is not a directory.\n`;
for (const [name, args] of [
  ["--list", ["--list"]],
  ["--which", ["--which", "write a commit message"]],
  ["--help", ["--help"]],
  ["a verb", ["commit", "--dry-run"]],
] as [string, string[]][]) {
  const bad = runIn(shadowDir, args, { LM_TOOLS: missing });
  check(`an LM_TOOLS naming no directory is refused by ${name}`, REFUSAL, bad.err);
  check(`and ${name} exits 2 rather than crashing`, 2, bad.code);
  check(`and ${name} prints no artefact`, "", bad.out);
}
// The path is what is wrong, not the flag, so a path that is there and is not a
// directory is the same refusal.
const file = runIn(shadowDir, ["--help"], { LM_TOOLS: join(shadowDir, "tools", "commit.sh") });
check("and a path that is a file rather than a directory reads the same",
  `lm: LM_TOOLS names ${join(shadowDir, "tools", "commit.sh")}, which is not a directory.\n`, file.err);
check("and a file exits 2 as well", 2, file.code);
// The two runners resolve the registry apart, so both have to hold the check.
const badDirect = runIn(shadowDir, ["--list"], { LM_TOOLS: missing }, join(ROOT, "libexec/lm-verb"));
check("and the shell runner refuses it in the same words", REFUSAL, badDirect.err);
check("and the shell runner exits 2 as well", 2, badDirect.code);
// A registry that is genuinely empty is the case the silence belongs to, and it
// keeps it: the refusal above is what tells the two inputs apart.
const emptyDir = project("empty-registry", { "keep.txt": "" });
const empty = runIn(emptyDir, ["--list"]);
check("a registry that holds nothing still says nothing", "", empty.out + empty.err);
check("and still exits 0", 0, empty.code);

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
