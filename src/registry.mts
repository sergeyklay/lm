import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type ToolMeta = { name: string; description: string; flags: string[] };
export type Result = { stdout: string; stderr: string; status: number };
export type Fn = "collect" | "schema" | "validate" | "render";
export type Opts = { args?: string[]; stdin?: string; cwd?: string; env?: Record<string, string> };

// Where a question goes when the terminal is not the runner's to read: the chat
// owns it. The runner never composes a question of its own, because it would
// have to know what a tool's fields mean to ask about them.
export type Ask = {
  confirm(question: string): Promise<boolean>;
  input(question: string): Promise<string | undefined>;
};

// The four read-only functions run before the human has approved anything, so a
// question asked from one of them is a defect and says so. apply is the one
// entitled to ask, and gets the answer the shell runner gets.
const REFUSE =
  'confirm() { echo "lm: confirm is available only inside apply" >&2; exit 1; }; '
  + 'ask() { echo "lm: ask is available only inside apply" >&2; exit 1; }; ';
const ASK =
  'confirm() { local a; read -r -p "$1 " a </dev/tty; [ "$a" = y ] || exit 7; }; '
  + 'ask() { local a; read -r -p "$1 " a </dev/tty; printf "%s" "$a"; }; ';
// The same two functions over a pair of file descriptors instead of the
// terminal: fd 3 carries the tool's own question out, fd 4 carries one line of
// answer back. A closed channel is a refusal, not a default.
const BRIDGE =
  'confirm() { printf "confirm\t%s\n" "$1" >&3; IFS= read -r a <&4 || exit 7; [ "$a" = y ] || exit 7; }; '
  + 'ask() { printf "input\t%s\n" "$1" >&3; IFS= read -r a <&4 || a=; printf "%s" "$a"; }; ';

const SOURCE = '. "$1" || exit $?; f=$2; shift 2; "$f" "$@"';

function bash(script: string, argv: string[], opts: Opts = {}): Result {
  const r = spawnSync("bash", ["-c", REFUSE + script, "bash", ...argv], {
    input: opts.stdin ?? "",
    encoding: "utf8",
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? 0 };
}

export function list(toolsDir: string): string[] {
  return readdirSync(toolsDir)
    .filter((f) => f.endsWith(".sh"))
    .sort()
    .map((f) => join(toolsDir, f));
}

export function meta(file: string): ToolMeta {
  const r = bash('. "$1" || exit $?; printf "%s\\0%s\\0%s" "$name" "$description" "${flags:-}"', [file]);
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${r.stderr.trim() || `exit ${r.status}`}`);
  const [name, description, flags] = r.stdout.split("\0");
  return { name, description, flags: flags ? flags.split(/\s+/).filter(Boolean) : [] };
}

export function call(file: string, fn: Fn, opts: Opts = {}): Result {
  return bash(SOURCE, [file, fn, ...(opts.args ?? [])], opts);
}

// apply is the only function with a side effect and the only one that talks to
// the human, so it does not go through bash() above. It runs under the same
// `set -euo pipefail` the shell runner gives it, because a body that fails
// halfway must not carry on and report success; and it inherits the terminal,
// because `confirm` reads /dev/tty and `issue` reads it again for its labels.
// Only the status comes back: everything it says has already been said.
export function apply(file: string, opts: Opts = {}): number {
  const r = spawnSync("bash", ["-euo", "pipefail", "-c", ASK + SOURCE, "bash", file, "apply"], {
    input: opts.stdin ?? "",
    stdio: ["pipe", "inherit", "inherit"],
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

// apply again, for a caller that owns no terminal. Everything the body writes
// comes back instead of being inherited, because the chat's screen is not a
// stream to print to, and every question it asks is carried out through `ask`
// with its own wording rather than restated by the runner.
export function applyAsk(file: string, opts: Opts, ask: Ask): Promise<{ status: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-euo", "pipefail", "-c", BRIDGE + SOURCE, "bash", file, "apply"], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    child.stdin!.end(opts.stdin ?? "");
    let output = "";
    let pending = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => (output += d));
    child.stderr!.on("data", (d: string) => (output += d));
    const answers = child.stdio[4] as NodeJS.WritableStream;
    const questions = child.stdio[3] as NodeJS.ReadableStream;
    questions.setEncoding?.("utf8");
    let chain: Promise<void> = Promise.resolve();
    questions.on("data", (d: string) => {
      pending += d;
      let i: number;
      while ((i = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        const tab = line.indexOf("\t");
        const kind = line.slice(0, tab);
        const question = line.slice(tab + 1);
        // Serialised: a body asking twice must not have its answers race, and
        // the human sees one dialog at a time.
        chain = chain.then(async () => {
          if (kind === "confirm") answers.write((await ask.confirm(question)) ? "y\n" : "n\n");
          else answers.write(((await ask.input(question)) ?? "") + "\n");
        });
      }
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });
}
