import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export type ToolMeta = { name: string; description: string; flags: string[] };
export type Result = { stdout: string; stderr: string; status: number };
export type Fn = "collect" | "schema" | "validate" | "render";
export type Opts = { args?: string[]; stdin?: string; cwd?: string; env?: Record<string, string> };

const PRELUDE =
  'confirm() { echo "lm: confirm is unavailable: apply does not run through this bridge" >&2; exit 1; }; ';

function bash(script: string, argv: string[], opts: Opts = {}): Result {
  const r = spawnSync("bash", ["-c", PRELUDE + script, "bash", ...argv], {
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
  return bash('. "$1" || exit $?; f=$2; shift 2; "$f" "$@"', [file, fn, ...(opts.args ?? [])], opts);
}
