// node tests/chrome.mts
//
// What the chat's own header and status rows say. The layout is what a person
// reads on every launch, so the cases pin the slots rather than the colours: a
// theme is the operator's to change, and the position of the branch is not.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerLines, footerLines, threeSlots, shortenCwd, formatTokens, formatDuration, summarize, summaryBlock, visibleWidth, version } from "../src/chrome.mts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

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

// A theme that emits real escapes, because the layout arithmetic has to see
// through them: a marker the width function does not recognise would make every
// case here agree with a status row that does not fit the terminal.
const CODE: Record<string, number> = { dim: 2, text: 37, error: 31, warning: 33, accent: 36, borderAccent: 34 };
const theme = {
  fg: (color: string, text: string) => `\x1b[${CODE[color] ?? 39}m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
};
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const styled = (s: string, color: string) => s.includes(`\x1b[${CODE[color]}m`);

check("the home directory becomes a tilde", "~/lm", shortenCwd("/home/ubuntu/lm", "/home/ubuntu"));
check("and the home directory itself is one character", "~", shortenCwd("/home/ubuntu", "/home/ubuntu"));
check("a path outside it is left whole", "/etc", shortenCwd("/etc", "/home/ubuntu"));
check("thousands are abbreviated", "12.3k", formatTokens(12345));
check("and hundreds are not", "999", formatTokens(999));

const header = headerLines(theme);
check("the header is two rows", 2, header.length);
check("and names the project and its version", true, plain(header[0]).includes(`lm v${version()}`));
check("in bold", true, header[0].includes("\x1b[1m"));
check("and says nothing about the harness", false, /pi|Pi/.test(plain(header.join("\n"))));
check("the second row tells the operator what to type", true,
  plain(header[1]).includes("/ for commands") && plain(header[1]).includes("@ for a file path"));
check("and it is dim rather than loud", true, styled(header[1], "dim"));
check("both rows carry the mark", true, header.every((l) => l.includes("█")));

const chrome = {
  cwd: "/home/ubuntu/lm",
  branch: "main",
  model: "qwen3.8:27b",
  contextTokens: 1200,
  contextWindow: 32768,
  autoCompact: true,
  input: 12345,
  output: 1234,
  thinking: "medium",
};

const rows = footerLines(theme, 78, chrome);
check("the status is two rows", 2, rows.length);
check("the first row opens on the directory", true, plain(rows[0]).startsWith("~/lm"));
check("carries the branch near the middle", true, /^.{30,44}main/.test(plain(rows[0])));
check("and ends with the model", true, plain(rows[0]).trimEnd().endsWith("qwen3.8:27b"));
check("the second row opens on the context and says the mode", true,
  plain(rows[1]).startsWith("3.7%/32.8k (auto)"));
check("carries what the session has spent beside it", true,
  plain(rows[1]).startsWith("3.7%/32.8k (auto)  ↑12.3k ↓1.2k"));
check("and ends with the thinking level", true, plain(rows[1]).trimEnd().endsWith("think medium"));
check("both rows fit the width", true, rows.every((l) => visibleWidth(l) <= 78));

// The spend is one thought and wears one colour; the model is the row above,
// where the operator reads what they chose rather than what it costs.
check("the spend is dim on both halves", true,
  styled(rows[1], "dim") && !rows[1].includes("\x1b[1m"));
// The level is the harness's own and means nothing for a model declared without
// reasoning, so the slot is empty rather than carrying a state the request does
// not have.
check("and a model with no level to report leaves the slot empty", true,
  plain(footerLines(theme, 78, { ...chrome, thinking: undefined })[1]).trimEnd().endsWith("↑12.3k ↓1.2k"));

// The label is a claim about a setting, so it is absent when the setting could
// not be read rather than guessed at.
check("an unread setting prints no mode",
  false, plain(footerLines(theme, 78, { ...chrome, autoCompact: undefined })[1]).includes("(auto)"));
check("and an unknown context prints a question mark", true,
  plain(footerLines(theme, 78, { ...chrome, contextTokens: null })[1]).startsWith("?/32.8k"));
check("a repository-less directory drops the branch", false,
  plain(footerLines(theme, 78, { ...chrome, branch: null })[0]).includes("main"));

// A narrow terminal loses the middle first and the right slot second, and never
// wraps: a wrapped status row pushes the chat off the screen.
check("a narrow width drops the centre", false, threeSlots(14, "~/lm", "main", "right").includes("main"));
check("a narrower one drops the right slot", "~/lm", threeSlots(8, "~/lm", "main", "right"));
check("and the left slot is truncated rather than wrapped", 4, visibleWidth(threeSlots(4, "~/lm/x", "", "")));

// The listing the harness prints on every launch is switched off by a setting
// and by nothing else, so the chat writes it once. In a scratch agent directory,
// because this must not touch the operator's own.
const work = mkdtempSync(join(tmpdir(), "lm-chrome-"));
const agentDir = join(work, "agent");
const settingsFile = join(agentDir, "settings.json");
const silence = () =>
  spawnSync(process.execPath, ["-e", 'import("./src/chrome.mts").then((m) => m.silenceStartup())'], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });

const first = silence();
check("writing the setting says nothing", "", (first.stdout ?? "") + (first.stderr ?? ""));
check("and the harness's own startup listing is switched off", true,
  existsSync(settingsFile) && JSON.parse(readFileSync(settingsFile, "utf8")).quietStartup === true);

writeFileSync(settingsFile, JSON.stringify({ quietStartup: true, theme: "light" }, null, 2));
const before = statSync(settingsFile).mtimeMs;
silence();
check("a setting already made is left alone", before, statSync(settingsFile).mtimeMs);
check("and nothing else in the file is disturbed", "light",
  JSON.parse(readFileSync(settingsFile, "utf8")).theme);
rmSync(work, { recursive: true, force: true });

// What the chat says on the way out. The figures are counts of what this session
// did and never one divided by another, so the fixtures are transcripts in the
// harness's own on-disk shape and the expectations are read off them by hand.
const FIXTURE = join(ROOT, "tests/fixtures/session-three-tools.jsonl");
function load(file: string) {
  const records = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { head: records.find((r) => r.type === "session"), entries: records.filter((r) => r.type !== "session") };
}
const { head, entries } = load(FIXTURE);
const block = (es: any[], h: any = head) => {
  const s = summarize(h, es);
  return s === null ? null : summaryBlock(s).join("\n");
};
const part = (text: string | null, n: number) => String(text).split("\n\n")[n];

check("the block opens on the session, what it ran and how long it took",
  "Session   01a04900-0000-7000-8000-00000000c0de\nTools     3 ran, 1 failed\nTime      12m 30s",
  part(block(entries), 0));
check("the table charges the spend to the model that answered",
  "Model         Reqs   Input   Cache   Output\nqwen3.8:27b      3   37.0k    3.0k     1.2k",
  part(block(entries), 1));
check("and the last line reopens the session from lm itself",
  "Resume: lm --session 01a04900-0000-7000-8000-00000000c0de", part(block(entries), 2));
check("every row of it reads on an eighty-column terminal", true,
  String(block(entries)).split("\n").every((l) => l.length <= 80));

// A zero the operator cannot see is a feature they cannot tell from one that was
// never built, which is what the suppressed clauses cost. Both counts are printed
// whatever they are.
const worked = entries.map((e) =>
  e.message?.role === "toolResult" ? { ...e, message: { ...e.message, isError: false } } : e);
check("a session whose tools all worked prints the failure count as a zero",
  "Tools     3 ran, 0 failed", String(block(worked)).split("\n")[1]);
check("a session that ran no tool prints both counts as zeroes",
  "Tools     0 ran, 0 failed",
  String(block(entries.filter((e) => e.message?.role !== "toolResult"))).split("\n")[1]);

// One model is one row, and a total row would repeat it. Two models are two rows
// and a sum the reader would otherwise do by hand.
const two = load(join(ROOT, "tests/fixtures/session-two-models.jsonl"));
check("a second model gets a row of its own and a total under both",
  "Model         Reqs   Input   Cache   Output\n"
  + "qwen3.8:27b      2    8.0k    1.0k      300\n"
  + "gpt-oss:20b      1    2.0k     500      150\n"
  + "total            3   10.0k    1.5k      450",
  part(block(two.entries, two.head), 1));
check("and the columns are still as wide as the widest cell in them", true,
  part(block(two.entries, two.head), 1).split("\n").every((l) => l.length === 43));

const at = (ms: number, message: any) => ({ type: "message", timestamp: new Date(ms).toISOString(), message });
const turn = (input: number, output: number) =>
  ({ role: "assistant", model: "qwen3.8:27b", usage: { input, output, cacheRead: 0, cacheWrite: 0 } });
const one = [at(1000, turn(500, 20)), at(4000, { role: "toolResult", toolName: "commit", isError: false })];
check("one tool is counted like any other", "Tools     1 ran, 0 failed",
  String(block(one, { id: "01a04900-0000-7000-8000-00000000c0de", timestamp: new Date(1000).toISOString() })).split("\n")[1]);

// A compaction is a model call, and its entry names no model, so the tokens it
// spent belong to whichever model was in force when it ran.
const compacted = [
  at(1000, turn(500, 20)),
  { type: "compaction", timestamp: new Date(2000).toISOString(), usage: { input: 100, output: 5 } },
];
check("a compaction is charged to the model in force when it ran",
  "Model         Reqs   Input   Cache   Output\nqwen3.8:27b      1     600       0       25",
  part(block(compacted, null), 1));
check("and an answer that names no model is charged to no model rather than dropped",
  "Model     Reqs   Input   Cache   Output\nunknown      1     500       0       20",
  part(block([at(1000, { role: "assistant", usage: { input: 500, output: 20 } })], null), 1));
// The harness declares the model in an entry of its own before any reply carries
// one, so a compaction before that reply is charged to the model then in force.
const declared = [
  { type: "model_change", timestamp: new Date(500).toISOString(), modelId: "gpt-oss:20b" },
  { type: "compaction", timestamp: new Date(1000).toISOString(), usage: { input: 100, output: 5 } },
  at(2000, turn(500, 20)),
];
check("and a model declared before the first reply is charged for what ran under it",
  "Model         Reqs   Input   Cache   Output\ngpt-oss:20b      0     100       0        5\n"
  + "qwen3.8:27b      1     500       0       20\ntotal            1     600       0       25",
  part(block(declared, null), 1));

// The span is the session's own, and the session record is what opens it: the
// first entry is written after the model and the thinking level are settled.
check("the span opens at the session record rather than at the first entry",
  "Time      1m", String(block([at(60_000, turn(500, 20))], { id: "01a04900-0000-7000-8000-00000000c0de", timestamp: new Date(0).toISOString() })).split("\n")[2]);
check("and falls back to the entries when there is no session record",
  "Tools   0 ran, 0 failed\nTime    0s", part(block([at(60_000, turn(500, 20))], null), 0));
// Without a session record there is no identifier, and a resume command naming
// none would not reopen anything.
check("which also leaves nothing to resume", 2, String(block([at(60_000, turn(500, 20))], null)).split("\n\n").length);

// Nothing was asked and nothing was answered, so there is nothing to report.
check("a session that never reached the model prints nothing", null,
  block([at(1000, { role: "user" })]));

check("a short session is counted in seconds", "45s", formatDuration(45_000));
check("a round one drops the seconds", "5m", formatDuration(300_000));
check("and a long one drops them for the minutes", "2h 5m", formatDuration(7_500_000));

// The unit cases above say the block is right. This says the harness reaches the
// handler that prints it, on the quit path and to the terminal it has already
// restored, which no assertion over `summarize` can show.
// The model is never asked: nothing is submitted, the catalogue read is off and
// the endpoint points nowhere, so a chat that tried would fail rather than run.
async function quitAfterOpening(argv: (session: string, dir: string) => string): Promise<string> {
  const quit = mkdtempSync(join(tmpdir(), "lm-quit-"));
  const session = join(quit, "2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl");
  copyFileSync(FIXTURE, session);
  const capture = join(quit, "capture.txt");
  const chat = spawn("script", ["-qc", `${ROOT}/bin/lm ${argv(session, quit)}`, capture], {
    cwd: ROOT,
    stdio: ["pipe", "ignore", "ignore"],
    env: { ...process.env, PI_CODING_AGENT_DIR: join(quit, "agent"), PI_OFFLINE: "1",
      LM_OLLAMA: "http://127.0.0.1:1", TERM: "xterm-256color", COLUMNS: "100", LINES: "30" },
  });
  const seen = () => (existsSync(capture) ? readFileSync(capture, "utf8") : "");
  const exited = new Promise<void>((r) => chat.on("exit", () => r()));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !seen().includes("for commands")) await wait(200);
  // Repeated because the key reaches a TUI that may still be drawing its first
  // frame, and an end of input it has not started reading is an end of input lost.
  while (Date.now() < deadline && chat.exitCode === null) {
    chat.stdin.write(String.fromCharCode(4));
    await Promise.race([exited, wait(500)]);
  }
  chat.kill("SIGKILL");
  await exited;
  const printed = seen().replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
  rmSync(quit, { recursive: true, force: true });
  return printed;
}

const printed = await quitAfterOpening((s, d) => `chat --session ${s} --session-dir ${d}`);
const BLOCK = ["Session   01a04900-0000-7000-8000-00000000c0de", "Tools     3 ran, 1 failed",
  "Model         Reqs   Input   Cache   Output", "qwen3.8:27b      3   37.0k    3.0k     1.2k",
  "Resume: lm --session 01a04900-0000-7000-8000-00000000c0de"];
check("quitting the chat prints the closing block on the restored terminal", true,
  BLOCK.every((l) => printed.includes(l)));
check("set off by a blank line from the frame the harness restored", true,
  printed.includes("\n\nSession   01a04900"));
check("and prints it above the harness's own resume line", true,
  printed.indexOf("Session   01a04900") >= 0
    && printed.indexOf("Session   01a04900") < printed.indexOf("To resume this session"));

// A session flag is the chat's and `lm` claims none of them, so the same session
// reopens without the subcommand in front. The closing block is the proof, because
// the harness computes it from the entries it loaded: a run that reopened nothing
// has nothing to count.
const noSubcommand = await quitAfterOpening((s, d) => `--session ${s} --session-dir ${d}`);
check("a session reopens without naming the chat first", true,
  BLOCK.every((l) => noSubcommand.includes(l)));

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
