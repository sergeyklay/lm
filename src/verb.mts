import { createAgentSession, SessionManager, SettingsManager, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { homedir } from "node:os";
import { call, apply, meta } from "./registry.mts";
import { resolveModel } from "./model.mts";
import { modelId } from "./provider.mts";

const MAX_CALLS = 2;

export type Args =
  | { ok: true; dry: boolean; text: string[]; env: Record<string, string> }
  | { ok: false; message: string };

// A flag and free text coexist in either order, so flags are found by scanning.
// A flag the tool never declared is a typo, and a typo must not become prompt
// text: '--dry-runn' read silently as words is a real commit where a rehearsal
// was asked for. Text after '--' is text, dashes and all.
export function parseArgs(verb: string, declared: string[], argv: string[]): Args {
  const out = { ok: true as const, dry: false, text: [] as string[], env: {} as Record<string, string> };
  let literal = false;
  for (const a of argv) {
    if (literal) { out.text.push(a); continue; }
    if (a === "--dry-run") { out.dry = true; continue; }
    if (a === "--") { literal = true; continue; }
    if (!a.startsWith("-")) { out.text.push(a); continue; }
    if (!declared.includes(a)) {
      return {
        ok: false,
        message: `lm: '${verb}' takes no flag '${a}'.\n`
          + `    Known: --dry-run${declared.length ? " " + declared.join(" ") : ""}.`
          + " Put text after -- to pass it literally.\n",
      };
    }
    out.env["LM_" + a.replace(/^--/, "").toUpperCase().replace(/-/g, "_")] = "1";
  }
  return out;
}

const sha = (s: string) => (s ? createHash("sha256").update(s).digest("hex") : null);
const git = (...a: string[]) =>
  (spawnSync("git", a, { encoding: "utf8" }).stdout ?? "").trim() || null;

const bareLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "Answer by calling the single available tool. Do not reply in prose.",
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
};

export type Outcome = { code: number; calls: number; attempts: number };

// `date -Is`: local time to the second with a numeric offset, which is the
// format every record in the log already carries. A silent switch to UTC would
// retype the field, and a retyped field invalidates every number taken before it.
function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, "0");
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)
    + (off < 0 ? "-" : "+") + pad(off / 60) + ":" + pad(off % 60);
}

// One JSON object per run, in the twenty-one fields `libexec/lm-verb` writes and
// in that order: `lm stats` is the only reader and every rate rests on the shape.
// The six the model reports are null here because /v1/chat/completions carries no
// timing field at all, and a key set that still matches is what keeps the log one
// population rather than two.
function record(r: {
  verb: string; dry: boolean; calls: number; violations: string; exit: number;
  ms: number; head0: string | null; prompt: string; answer: string | undefined;
}): void {
  const log = process.env.LM_LOG ?? `${homedir()}/.lm/runs.jsonl`;
  if (!log) return;
  const head = git("rev-parse", "HEAD");
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, JSON.stringify({
      ts: localIso(new Date()),
      repo: basename(git("rev-parse", "--show-toplevel") ?? process.cwd()),
      verb: r.verb,
      model: modelId(),
      dry: r.dry,
      calls: r.calls,
      violations: r.violations.split("\n").filter((l) => l.length > 0),
      exit: r.exit,
      ms: r.ms,
      head_moved: head !== null && head !== r.head0,
      composition: process.env.LM_COMPOSITION || null,
      which: null,
      prompt_hash: sha(r.prompt),
      answer_hash: r.answer === undefined ? null : sha(r.answer),
      answer_len: r.answer === undefined ? null : r.answer.length,
      total_duration: null,
      load_duration: null,
      prompt_eval_count: null,
      prompt_eval_duration: null,
      eval_count: null,
      eval_duration: null,
    }) + "\n");
  } catch {
    // Never fails the run it is reporting on.
  }
}

export async function runVerb(file: string, argv: string[], env: Record<string, string> = {}): Promise<Outcome> {
  const t0 = Date.now();
  const head0 = git("rev-parse", "HEAD");
  const info = meta(file);
  const name = info.name;
  const cwd = process.cwd();

  // Parsed before the record exists, because a typo reaches no model and the
  // shell runner arms its trap after this loop for the same reason.
  const parsed = parseArgs(name, info.flags, argv);
  if (!parsed.ok) {
    process.stderr.write(parsed.message);
    return { code: 2, calls: 0, attempts: 0 };
  }

  const opts = { cwd, env: { ...env, ...parsed.env } };
  let calls = 0;
  let attempts = 0;
  let violations = "";
  let firstViolations = "";
  let rendered = "";
  let answer: string | undefined;
  let truncated = false;

  const finish = (code: number, prompt: string): Outcome => {
    record({ verb: name, dry: parsed.dry, calls, violations: firstViolations, exit: code,
             ms: Date.now() - t0, head0, prompt, answer });
    return { code, calls, attempts };
  };

  const collected = call(file, "collect", { ...opts, args: parsed.text });
  process.stderr.write(collected.stderr);
  if (collected.status !== 0) return finish(collected.status, "");
  const prompt = collected.stdout;

  for (const a of parsed.text) {
    if (a.startsWith("-")) continue;
    if (!prompt.includes(a)) process.stderr.write(`lm: '${name}' made no use of the text you gave it\n`);
    break;
  }

  const schema = call(file, "schema", opts);
  if (schema.status !== 0) {
    process.stderr.write(schema.stderr);
    return finish(schema.status, prompt);
  }

  const { model } = await resolveModel();

  const { session } = await createAgentSession({
    cwd,
    model,
    sessionManager: SessionManager.inMemory(),
    // A verb costs one model call and one deterministic retry, and both of the
    // harness's own ways of spending more are on by default and read from the
    // operator's settings file rather than from this repository: an auto-retry
    // of three on a retryable error, and a compact-and-retry on an answer the
    // budget cut short. Neither is counted by anything the runner can see.
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
    resourceLoader: bareLoader as any,
    noTools: "all",
    tools: [name],
    customTools: [
      {
        name,
        label: name,
        description: info.description,
        parameters: JSON.parse(schema.stdout),
        execute: async (_id: string, params: unknown) => {
          attempts += 1;
          answer = JSON.stringify(params);
          const v = call(file, "validate", { ...opts, stdin: answer });
          violations = v.stdout.trim();
          if (attempts === 1) firstViolations = violations;
          // The model reads the violations here, not only in the follow-up: a
          // result without a `content` array is normalised to the literal string
          // "(no tool output)" before it reaches the wire.
          if (violations) return { content: [{ type: "text", text: `VIOLATION:\n${violations}` }], details: undefined, terminate: true };
          rendered = call(file, "render", { ...opts, stdin: answer }).stdout;
          return { content: [{ type: "text", text: "accepted" }], details: undefined, terminate: true };
        },
      } as any,
    ],
  });

  session.subscribe((e: any) => {
    // One assistant message is one request to the model. A turn is not: the
    // harness's own comment on resetting its retry counter says a turn holds
    // several calls, and `calls` sits in the log beside what the run cost.
    if (e.type === "message_end" && e.message?.role === "assistant") {
      calls += 1;
      if (e.message.stopReason === "length") truncated = true;
    }
    if (e.type === "turn_end" && violations && !truncated && attempts < MAX_CALLS) {
      session.agent.followUp({
        role: "user",
        content: [{ type: "text", text: `The previous attempt was rejected for these reasons. Fix them and call ${name} again:\n${violations}` }],
        timestamp: Date.now(),
      } as any);
    }
  });

  await session.prompt(prompt);

  // Ahead of the other two, because a cut-off answer often still parses and
  // still passes validate(), and because the exit code alone cannot tell this
  // case from an answer that never arrived.
  if (truncated) {
    process.stderr.write("lm: the answer hit the token budget and is cut off\n");
    return finish(5, prompt);
  }
  if (attempts === 0) {
    process.stderr.write("lm: model returned no answer (a failure, not an empty answer)\n");
    return finish(5, prompt);
  }
  if (violations) {
    process.stderr.write("lm: validator rejected two attempts:\n");
    process.stderr.write(violations.replace(/^/gm, "  - ") + "\n");
    return finish(4, prompt);
  }

  process.stdout.write(rendered);
  // The guard sits between render and apply, and the position is the contract: a
  // --dry-run that applies and then declines to mention it is indistinguishable
  // from a working one until the first time it writes something.
  if (parsed.dry) {
    process.stdout.write("\n--dry-run: no side effect\n");
    return finish(0, prompt);
  }
  return finish(apply(file, { ...opts, stdin: answer! }), prompt);
}
