// node tests/cli.mts

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
for (const line of ["open a chat", "lm ship", "lm stats", "--dry-run", "--which", "LM_MODEL"]) {
  check(`--help covers ${line}`, true, help.out.includes(line));
}
for (const verb of ["changelog", "commit", "issue", "pr"]) {
  check(`--help lists ${verb}`, true, new RegExp(`^  ${verb}\\s`, "m").test(help.out));
}
check("help goes to stdout, not stderr", "", help.err);

check("-h is the same help", help.out, run(LM, ["-h"]).out);
check("help wins after a verb", help.out, run(LM, ["commit", "--help"]).out);

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

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
