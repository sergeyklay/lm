// node tests/registry.mts

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { list, meta, call } from "../src/registry.mts";

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

function viaBash(file: string, script: string, cwd = ROOT): string {
  const r = spawnSync("bash", ["-c", `. "$1" || exit $?; ${script}`, "bash", file],
    { encoding: "utf8", cwd });
  return r.stdout ?? "";
}

const files = list(TOOLS);
const fromBash = spawnSync(join(ROOT, "bin/lm"), ["--list"], { encoding: "utf8", cwd: ROOT })
  .stdout.trim().split("\n").map((l) => l.split("\t")[0]).sort();
check("the registry lists what bin/lm lists", fromBash, files.map((f) => basename(f, ".sh")).sort());

for (const f of files) {
  const m = meta(f);
  check(`${m.name}: name matches bash`, viaBash(f, 'printf %s "$name"'), m.name);
  check(`${m.name}: description matches bash`, viaBash(f, 'printf %s "$description"'), m.description);
  check(`${m.name}: flags match bash`, viaBash(f, 'printf %s "${flags:-}"'), m.flags.join(" "));
  check(`${m.name}: schema matches bash`, viaBash(f, "schema"), call(f, "schema", { cwd: ROOT }).stdout);
}

const work = mkdtempSync(join(tmpdir(), "lm-registry-"));
writeFileSync(join(work, "stub.sh"), [
  'name="stub"',
  'description="exercises the bridge and nothing else"',
  'flags="--force"',
  'collect() { echo "lm: nothing to do" >&2; return 3; }',
  "schema() { pwd -P; }",
  'validate() { local j; j=$(cat); [ "$j" = ok ] || echo "answer must be ok"; }',
  'render() { cat; echo; }',
  "",
].join("\n"));
const stub = join(work, "stub.sh");

check("a declared flag is read", ["--force"], meta(stub).flags);

// Asserted against a directory this process is not in: the four schema cases above
// inherit ROOT, so removing cwd from the bridge leaves every one of them green.
check("the working directory is passed through", realpathSync(work),
  call(stub, "schema", { cwd: work }).stdout.trim());

const refused = call(stub, "collect");
check("collect's refusal keeps its status", "3", String(refused.status));
check("and its message reaches stderr", "lm: nothing to do", refused.stderr.trim());
check("validate reads the answer from stdin", "answer must be ok",
  call(stub, "validate", { stdin: "bad" }).stdout.trim());
check("a clean answer prints no violation", "", call(stub, "validate", { stdin: "ok" }).stdout.trim());
check("render receives the answer too", "ok", call(stub, "render", { stdin: "ok" }).stdout.trim());

writeFileSync(join(work, "asks.sh"), [
  'name="asks"', 'description="calls confirm"',
  'collect() { confirm "really? [y/N]"; echo REACHED; }',
  "",
].join("\n"));
const asked = call(join(work, "asks.sh"), "collect");
check("confirm stops the tool where it stands", "", asked.stdout.trim());
check("and does not exit 0", "true", String(asked.status !== 0));
check("and says why", "true", String(/confirm is unavailable/.test(asked.stderr)));

rmSync(work, { recursive: true, force: true });

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
