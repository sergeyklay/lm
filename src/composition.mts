import { basename } from "node:path";
import { hook, list, meta } from "./registry.mts";
import { parseArgs, runVerb, terminal, type Io, type Outcome } from "./verb.mts";

// Who is asking, so a dialog carries the verb that asked rather than the delivery
// it belongs to. The command line answers the same terminal for every label.
export type IoFor = (label: string) => Io;
export const terminalFor: IoFor = () => terminal;

// A composition names the verbs it runs and defines the work around them, and the
// runner runs both halves. A script could only reach a verb by spawning one, and
// in that process `confirm` reads /dev/tty, which the chat does not have, so the
// human would never be asked at all.
//
// The tag is the caller's because its scope is the caller's: one process per
// `lm ship` on the command line, one session per chat and a counter inside it.
export async function runComposition(
  file: string,
  toolsDir: string,
  argv: string[],
  tag: string,
  io: IoFor = terminalFor,
): Promise<Outcome> {
  const info = meta(file);
  const own = io(info.name);
  const parsed = parseArgs(info.name, info.flags, argv);
  if (!parsed.ok) {
    own.err(parsed.message);
    return { code: 2, calls: 0, attempts: 0 };
  }

  // The flags reach the hooks the way they reach a tool: parseArgs turns --here
  // into LM_HERE, so a hook reads its own flag and nothing parses twice.
  const env = { ...parsed.env, LM_COMPOSITION: tag };
  const opts = { cwd: process.cwd(), env };
  const verbArgv = [
    ...(parsed.dry ? ["--dry-run"] : []),
    ...(parsed.text.length > 0 ? ["--", ...parsed.text] : []),
  ];

  const tools = new Map(list(toolsDir).map((f) => [basename(f, ".sh"), f]));
  let calls = 0;
  let attempts = 0;

  const step = (fn: string): number => {
    const r = hook(file, fn, opts);
    own.out(r.stdout);
    own.err(r.stderr);
    return r.status;
  };

  const prepared = step("prepare");
  if (prepared !== 0) return { code: prepared, calls, attempts };

  let code = 0;
  for (const verb of info.verbs) {
    const tool = tools.get(verb);
    if (!tool) {
      own.err(`lm: '${info.name}' names no verb '${verb}'\n`);
      return { code: 2, calls, attempts };
    }

    const before = step(`before_${verb}`);
    if (before !== 0) return { code: before, calls, attempts };

    const r = await runVerb(tool, verbArgv, env, io(verb), tag);
    calls += r.calls;
    attempts += r.attempts;
    code = r.code;
    if (code !== 0) {
      step(`failed_${verb}`);
      return { code, calls, attempts };
    }

    const after = step(`after_${verb}`);
    if (after !== 0) return { code: after, calls, attempts };
  }

  return { code, calls, attempts };
}
