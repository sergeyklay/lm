import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

export type ToolMeta = { name: string; description: string; flags: string[]; verbs: string[] };
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
// A confirmation with a terminal open and nobody typing at it blocks with no bound
// at all: measured 2026-08-27 under a pty held open by a fifo, the run reported 124
// from the harness that killed it rather than any exit of its own. The bound is here
// rather than spelled into the line, because the same number belongs in the shell
// runner's copy of it and a person who wants to argue with it should find it first.
export const CONFIRM_TIMEOUT_SECONDS = 120;

// The timeout is not a refusal the human made, so it says why before it exits: bash
// returns above 128 when a read times out and 1 at end of input, which is what tells
// the operator who walked away from an open terminal apart from a run that never had
// one and has already been told so by the shell.
const timedRead = (after: string) =>
  `local a rc=0; read -r -t ${CONFIRM_TIMEOUT_SECONDS} -p "$1 " a </dev/tty || rc=$?; `
  + `[ "$rc" -le 128 ] || printf "\nlm: no answer in ${CONFIRM_TIMEOUT_SECONDS}s, nothing was applied\n" >&2; `
  + `[ "$rc" = 0 ] || exit 7; ${after}`;
const ASK =
  `confirm() { ${timedRead('[ "$a" = y ] || exit 7; ')}}; `
  + `ask() { ${timedRead('printf "%s" "$a"; ')}}; `;

// The run that declares itself unattended, through --yes or LM_YES. confirm answers
// yes and ask answers an empty line, which is not a new design but the answer
// docs/tools.md already fixes the meaning of: an empty line is an answer and the tool
// decides what it means, so an unasked ask is a vote for what the model proposed.
// Nothing here reads a terminal, so exit 7 stops appearing rather than changing sense.
const YES = 'confirm() { :; }; ask() { :; }; ';
// The same two functions over a pair of file descriptors instead of the
// terminal: fd 3 carries the tool's own question out, fd 4 carries one line of
// answer back. No answer at all is a refusal and exits 7, for both: a human who
// closed the dialog decided nothing, and a channel deciding on their behalf is
// the defect this shape exists to avoid. An empty line is an answer, and what it
// means belongs to the tool: `issue` reads it as keeping the labels it proposed.
const BRIDGE =
  'confirm() { printf "confirm\t%s\n" "$1" >&3; IFS= read -r a <&4 || exit 7; [ "$a" = y ] || exit 7; }; '
  + 'ask() { printf "input\t%s\n" "$1" >&3; IFS= read -r a <&4 || exit 7; printf "%s" "$a"; }; ';

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

// The index is still a directory listing, of every directory in the precedence in
// turn. A name the nearer directory already supplied is skipped rather than read
// twice, so a tool appears once whatever shadows it.
export function list(dirs: string[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sh"))) {
      if (seen.has(f)) continue;
      seen.add(f);
      files.push(join(dir, f));
    }
  }
  return files.sort((a, b) => (basename(a) < basename(b) ? -1 : 1));
}

export function meta(file: string): ToolMeta {
  const r = bash('. "$1" || exit $?; printf "%s\\0%s\\0%s\\0%s" "$name" "$description" "${flags:-}" "${verbs:-}"', [file]);
  if (r.status !== 0) throw new Error(`cannot read ${file}: ${r.stderr.trim() || `exit ${r.status}`}`);
  const [name, description, flags, verbs] = r.stdout.split("\0");
  const words = (s: string | undefined) => (s ? s.split(/\s+/).filter(Boolean) : []);
  return { name, description, flags: words(flags), verbs: words(verbs) };
}

export function call(file: string, fn: Fn, opts: Opts = {}): Result {
  return bash(SOURCE, [file, fn, ...(opts.args ?? [])], opts);
}

// A workflow's own step, around the verbs it names. A step nobody wrote is not
// a failure: the file defines only the hooks it needs, so an undefined one is a
// no-op rather than a `command not found`.
export function hook(file: string, fn: string, opts: Opts = {}): Result {
  const script = '. "$1" || exit $?; f=$2; shift 2; declare -F "$f" >/dev/null || exit 0; "$f" "$@"';
  return bash(script, [file, fn, ...(opts.args ?? [])], opts);
}

// apply is the only function with a side effect and the only one that talks to
// the human, so it does not go through bash() above. It runs under the same
// `set -euo pipefail` the shell runner gives it, because a body that fails
// halfway must not carry on and report success; and it inherits the terminal,
// because `confirm` reads /dev/tty and `issue` reads it again for its labels.
// Only the status comes back: everything it says has already been said.
export function apply(file: string, opts: Opts = {}, yes = false): number {
  const r = spawnSync("bash", ["-euo", "pipefail", "-c", (yes ? YES : ASK) + SOURCE, "bash", file, "apply"], {
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
    // A refused question ends the channel, and the body may already have asked
    // the next one before reading the answer to this one. Answering into a
    // closed pipe is not this function's failure to report.
    answers.on("error", () => {});
    const answer = (line: string) => {
      if (!(answers as any).writableEnded) answers.write(line);
    };
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
          if (kind === "confirm") {
            answer((await ask.confirm(question)) ? "y\n" : "n\n");
            return;
          }
          const line = await ask.input(question);
          // Nothing to answer with closes the channel rather than sending an
          // empty line, because an empty line is a decision the human made.
          if (line === undefined) answers.end();
          else answer(line + "\n");
        });
      }
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });
}
