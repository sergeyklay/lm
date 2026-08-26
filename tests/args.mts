// node tests/args.mts

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { parse } from "../src/args.mts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const OLD = join(ROOT, "bin/lm");
const NEW = join(ROOT, "bin/lm-next");
let fail = 0;

function check(name: string, want: unknown, got: unknown) {
  const w = String(want), g = String(got);
  if (w === g) console.log(`ok   ${name}`);
  else {
    console.log(`FAIL ${name}\n  want: ${JSON.stringify(w)}\n  got:  ${JSON.stringify(g)}`);
    fail = 1;
  }
}

type Run = { out: string; err: string; code: number };
function run(bin: string, args: string[]): Run {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd: ROOT, env: { ...process.env, LM_LOG: "" } });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 0 };
}

function same(name: string, args: string[], parts: Array<keyof Run> = ["out", "err", "code"]) {
  const a = run(OLD, args), b = run(NEW, args);
  for (const p of parts) check(`${name} — ${p}`, a[p], b[p]);
}

same("--list", ["--list"]);
same("--help", ["--help"]);
same("-h", ["-h"]);
same("no arguments", []);
same("help wins after a verb", ["commit", "--help"]);
same("help wins after an unknown verb", ["nosuch", "--help"]);
same("an unknown verb", ["nosuch"]);
same("an undeclared flag", ["commit", "--nope"]);
same("an undeclared flag on a tool that has one", ["changelog", "--nope"]);

// No shipped tool declares a flag, so the rest is the parser on its own. bin/lm
// reaches the model as soon as the arguments are good, and a matching exit 2 there
// would be the two programs failing for different reasons rather than agreeing.
const p = (argv: string[], flags: string[] = []) => parse(argv, "stub", flags);

check("a declared flag becomes a variable",
  JSON.stringify({ LM_NO_STAGE: "1" }),
  JSON.stringify(p(["--no-stage"], ["--no-stage"]).ok && p(["--no-stage"], ["--no-stage"]).env));
check("--dry-run is the runner's own", true, p(["--dry-run"]).ok && p(["--dry-run"]).dry);
check("text after -- keeps its dashes",
  JSON.stringify(["--not-a-flag"]),
  JSON.stringify(p(["--", "--not-a-flag"]).ok && p(["--", "--not-a-flag"]).args));
check("a flag and text coexist in either order",
  JSON.stringify(["what", "changed"]),
  JSON.stringify(p(["what", "--dry-run", "changed"]).ok && p(["what", "--dry-run", "changed"]).args));
check("an undeclared flag is refused", false, p(["--nope"]).ok);
check("and the refusal names the known ones", true,
  !p(["--nope"], ["--force"]).ok && /Known: --dry-run --force\./.test(p(["--nope"], ["--force"]).message));

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
