import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type ToolMeta = { name: string; description: string; flags: string[] };
export type Result = { stdout: string; stderr: string; status: number };
export type Fn = "collect" | "schema" | "validate" | "render";
export type Opts = { args?: string[]; stdin?: string; cwd?: string; env?: Record<string, string> };

// The four read-only functions run before the human has approved anything, so a
// confirmation asked from one of them is a defect and says so. apply is the one
// entitled to it, and gets the answer the shell runner gets.
const REFUSE =
  'confirm() { echo "lm: confirm is available only inside apply" >&2; exit 1; }; ';
const ASK =
  'confirm() { local a; read -r -p "$1 " a </dev/tty; [ "$a" = y ] || exit 7; }; ';

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
