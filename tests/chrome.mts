// node tests/chrome.mts
//
// What the chat's own header and status rows say. The layout is what a person
// reads on every launch, so the cases pin the slots rather than the colours: a
// theme is the operator's to change, and the position of the branch is not.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerLines, footerLines, threeSlots, shortenCwd, formatTokens, formatDuration, summarize, summaryBlock, visibleWidth, version, dropHarnessResume, type SessionLocation, type Sitting } from "../src/chrome.mts";
import { pickTarget, updateHarness } from "../src/update.mts";

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

// What a launch that updated the harness says, and what one that did not says
// instead. The session is already on the version named, so the row reports
// rather than instructs, and a launch that moved nothing adds no row at all.
const moved = headerLines(theme, "0.84.4");
check("a launch that updated the harness adds a third row", 3, moved.length);
check("naming the version it moved to", true, plain(moved[2]).includes("harness updated to 0.84.4"));
check("without telling the operator to restart", false, /restart|Run |update the/.test(plain(moved[2])));
check("dim rather than loud", true, styled(moved[2], "dim"));
check("and aligned under the name above it", true, plain(moved[2]).startsWith(`${" ".repeat(visibleWidth("█ █▀█") + 2)}harness`));
check("a launch that moved nothing adds no row", 2, headerLines(theme, undefined).length);

// Which version a launch installs, off the registry. The range `package.json`
// declares is the whole of the policy, so the arithmetic is pinned against a
// list of releases rather than against what npm happens to be publishing.
check("the newest release the range admits is the target", "0.84.4",
  pickTarget(["0.83.9", "0.84.3", "0.84.4", "0.85.0", "1.0.0"], "^0.84.3", "0.84.3"));
check("a newer release outside the range is refused", undefined,
  pickTarget(["0.85.0", "1.0.0"], "^0.84.3", "0.84.3"));
check("and nothing moves when the newest in range is already installed", undefined,
  pickTarget(["0.84.3", "0.84.4", "0.85.0"], "^0.84.3", "0.84.4"));

const npm: string[] = [];
check("a launch installs the target and reports the version it moved to", "0.84.4",
  await updateHarness({ published: async () => ["0.84.3", "0.84.4", "0.85.0"], install: (v) => { npm.push(v); return true; } }));
check("naming that version to npm and no other", ["0.84.4"], npm);
check("a launch already on the newest in range reports nothing", undefined,
  await updateHarness({ published: async () => ["0.84.3"], install: () => true }));

// Every way this can fail leaves the chat opening on the version installed, with
// nothing printed and nothing thrown: an update that did not happen is not news.
check("PI_OFFLINE asks the registry nothing at all", undefined,
  await updateHarness({ allowNetwork: false, published: async () => { throw new Error("asked"); }, install: () => true })
    .catch((e) => `threw ${e}`));
check("a registry that cannot be reached is silent rather than an error", undefined,
  await updateHarness({ published: async () => { throw new Error("no route to host"); }, install: () => true })
    .catch((e) => `threw ${e}`));
check("a registry answering rubbish is silent too", undefined,
  await updateHarness({ published: async () => ["not a version"], install: () => true })
    .catch((e) => `threw ${e}`));
check("and an install that fails reports no version", undefined,
  await updateHarness({ published: async () => ["0.84.4"], install: () => false })
    .catch((e) => `threw ${e}`));

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
// Both fixtures are sessions this launch opened, so the sitting runs from a
// launch a second ahead of the session record to the moment the last entry was
// written: what the block says of them is what it said on the day.
const RECORD = Date.parse("2026-08-28T20:00:00.000Z");
const OPENED: Sitting = { launchedAt: RECORD - 1000, endedAt: Date.parse("2026-08-28T20:12:30.000Z") };
// An identifier resolves against the harness's default session directory alone,
// so where the session is kept decides which of the two the resume line can name.
const FILE = "/home/ubuntu/.pi/sessions/--home-ubuntu-lm--/2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl";
const HOME: SessionLocation = { file: FILE, isDefaultDir: true };
const AWAY: SessionLocation = { file: "/srv/sessions/2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl", isDefaultDir: false };
const block = (es: any[], h: any = head, sitting: Sitting = OPENED, where: SessionLocation = HOME) => {
  const s = summarize(h, es, sitting, where);
  return s === null ? null : summaryBlock(s).join("\n");
};
const part = (text: string | null, n: number) => String(text).split("\n\n")[n];

check("the block opens on the session, what it ran and how long it took",
  "Session   01a04900-0000-7000-8000-00000000c0de\nTools     3 ran, 1 failed\nTime      12m 30s",
  part(block(entries), 0));
check("the table charges the spend to the model that answered",
  "Model         Reqs   Input   Cache   Output\nqwen3.8:27b      3   37.0k    3.0k     1.2k",
  part(block(entries), 1));
check("and it closes on the command that reopens the session, over two lines",
  "Resume this session with:\nlm --resume 01a04900-0000-7000-8000-00000000c0de", part(block(entries), 2));
// The identifier is the shorter line and the one the operator reads on the row
// above, but it resolves in one directory. A session kept anywhere else is named
// by its file, which reopens it wherever it is.
check("a session outside that directory is named by its file instead",
  `Resume this session with:\nlm --resume ${AWAY.file}`, part(block(entries, head, OPENED, AWAY), 2));
// The harness declares no method that answers this, so a build that stops
// shipping one leaves the question open, and an open question takes the file.
check("and a directory the harness will not answer for takes the file too",
  `Resume this session with:\nlm --resume ${AWAY.file}`,
  part(block(entries, head, OPENED, { file: AWAY.file, isDefaultDir: undefined }), 2));
check("but with no file to name it falls back to the identifier",
  "Resume this session with:\nlm --resume 01a04900-0000-7000-8000-00000000c0de",
  part(block(entries, head, OPENED, { file: undefined, isDefaultDir: undefined }), 2));
// The line is pasted into a shell, so a path that is more than one word there is
// quoted rather than printed as a command that would open something else.
check("a path a shell would split is quoted",
  "Resume this session with:\nlm --resume '/srv/my sessions/a.jsonl'",
  part(block(entries, head, OPENED, { file: "/srv/my sessions/a.jsonl", isDefaultDir: false }), 2));
check("every row of it reads on an eighty-column terminal", true,
  String(block(entries)).split("\n").every((l) => l.length <= 80));

// The two lines are a command to paste rather than a figure to read, so they
// wear the grey the status row spends on `think`. The block is written once the
// harness has stopped the TUI, where the theme a render callback is handed is
// gone, so the colour arrives as an argument instead of being read in here.
const rowsOf = (dim?: (text: string) => string) => {
  const s = summarize(head, entries, OPENED, HOME);
  return s === null ? [] : summaryBlock(s, dim);
};
const coloured = rowsOf((text) => theme.fg("dim", text));
check("the two lines that reopen the session are dim", true,
  coloured.slice(-2).every((l) => styled(l, "dim")));
check("and nothing above them carries a colour of its own", true,
  coloured.slice(0, -2).every((l) => l === plain(l)));
check("the words are the same ones a terminal without colour reads",
  part(block(entries), 2), coloured.slice(-2).map(plain).join("\n"));
check("and with no colour to spend they are printed as text", true,
  rowsOf().slice(-2).every((l) => l === plain(l)));

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

// The first figure is this sitting, and a session this launch created opens it at
// its own record: the first entry is written after the model and the thinking
// level are settled, and the launch runs before the record exists.
const record = (ms: number) => ({ id: "01a04900-0000-7000-8000-00000000c0de", timestamp: new Date(ms).toISOString() });
check("the span opens at the session record rather than at the first entry",
  "Time      1m 30s",
  String(block([at(62_000, turn(500, 20))], record(2000), { launchedAt: 1000, endedAt: 92_000 })).split("\n")[2]);
// A session older than the launch was reopened, so what this sitting cost and
// what the whole conversation cost are two facts and get a row each.
check("a session opened before this launch reports the sitting and the conversation under it",
  "Time      2m\nHistory   12m 30s",
  String(block(entries, head, { launchedAt: RECORD + 750_000, endedAt: RECORD + 870_000 })).split("\n").slice(2, 4).join("\n"));
check("and a session this launch opened reports the sitting alone", false,
  String(block(entries)).includes("History"));
check("and opens the sitting at the launch when there is no session record",
  "Tools   0 ran, 0 failed\nTime    1m", part(block([at(60_000, turn(500, 20))], null, { launchedAt: 30_000, endedAt: 90_000 }), 0));
// Without a session record there is no identifier, and a resume command naming
// none would not reopen anything.
check("which also leaves nothing to resume", 2,
  String(block([at(60_000, turn(500, 20))], null, { launchedAt: 30_000, endedAt: 90_000 })).split("\n\n").length);

// Nothing was asked and nothing was answered, so there is nothing to report.
check("a session that never reached the model prints nothing", null,
  block([at(1000, { role: "user" })]));

check("a short session is counted in seconds", "45s", formatDuration(45_000));
check("a round one drops the seconds", "5m", formatDuration(300_000));
check("and a long one drops them for the minutes", "2h 5m", formatDuration(7_500_000));

// The harness writes a resume line of its own after the last shutdown handler
// has returned, saying what the block already said under the name of another
// program. It is dropped by wrapping the write for one chunk, and the block
// itself is written through that wrap: what the harness dims is the same word
// this project's own last line opens on, so the match is on the whole opening
// of the harness's line and nothing shorter.
const HARNESS_LINE = "\x1b[2mTo resume this session:\x1b[22m pi --session 01a04900\n";
const written: unknown[] = [];
const sink = { write: (chunk: unknown) => { written.push(chunk); return true; } };
const passthrough = sink.write;
dropHarnessResume(sink);
const own = `\n${block(entries)}\n`;
check("this project's own block is not what the wrap is looking for", own,
  (sink.write(own), String(written.at(-1))));
check("and a chunk that is not text is passed on rather than read", "<binary>",
  (() => { try { sink.write(Buffer.from("<binary>")); return String(written.at(-1)); } catch (e) { return `threw ${e}`; } })());
check("the harness's own resume line is dropped", 2,
  (sink.write(HARNESS_LINE), written.length));
check("and the original write is back the moment it has been", true, sink.write === passthrough);
check("so a second line like it reaches the terminal", HARNESS_LINE,
  (sink.write(HARNESS_LINE), String(written.at(-1))));

// The unit cases above say the block is right. This says the harness reaches the
// handler that prints it, on the quit path and to the terminal it has already
// restored, which no assertion over `summarize` can show.
// The model is never asked: nothing is submitted, the catalogue read is off and
// the endpoint points nowhere, so a chat that tried would fail rather than run.
async function quitAfterOpening(
  argv: (session: string, dir: string) => string,
  holds: (quit: string) => string = (quit) => quit,
  from: string = FIXTURE,
): Promise<{ printed: string; raw: string; session: string }> {
  const quit = mkdtempSync(join(tmpdir(), "lm-quit-"));
  const dir = holds(quit);
  mkdirSync(dir, { recursive: true });
  const session = join(dir, "2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl");
  copyFileSync(from, session);
  const capture = join(quit, "capture.txt");
  const chat = spawn("script", ["-qc", `${ROOT}/bin/lm ${argv(session, dir)}`, capture], {
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
  const raw = seen();
  const printed = raw.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
  rmSync(quit, { recursive: true, force: true });
  return { printed, raw, session };
}

// Where the harness keeps a session by default, and the only directory an
// identifier resolves in: the agent directory, then the working directory with
// its separators flattened.
const defaultSessions = (quit: string) =>
  join(quit, "agent", "sessions", `--${ROOT.replace(/^\//, "").replace(/\//g, "-")}--`);

const { printed, raw, session: away } = await quitAfterOpening((s, d) => `chat --session ${s} --session-dir ${d}`);
const BLOCK = ["Session   01a04900-0000-7000-8000-00000000c0de", "Tools     3 ran, 1 failed",
  "Model         Reqs   Input   Cache   Output", "qwen3.8:27b      3   37.0k    3.0k     1.2k"];
check("quitting the chat prints the closing block on the restored terminal", true,
  BLOCK.every((l) => printed.includes(l)));
// The session is not in the directory an identifier resolves in, so the line
// names the file, which reopens it from wherever it is.
check("and a session held outside the default directory is resumed by its file", true,
  printed.includes(`Resume this session with:\nlm --resume ${away}`));
check("naming no identifier the chat could not have found it by", false,
  printed.includes("lm --resume 01a04900-0000-7000-8000-00000000c0de"));
// Every case here reads a capture the escapes have been stripped out of, so the
// colour is only visible in the one that was not. The theme is the harness's own
// and its grey is whatever the operator's theme says, so what is pinned is that
// the two lines were coloured and reset rather than which colour came out.
check("and the two lines it prints wear a colour the theme chose", true,
  /\x1b\[[0-9;]+mResume this session with:\x1b\[39m/.test(raw));
check("which the block above them does not", false, /\x1b\[[0-9;]+mTools /.test(raw));
// The two figures differ only where a session outlived a launch, and this run is
// that: the fixture's own record is dated before any run of this suite, while the
// sitting is the seconds this case spends in the chat before ending it.
const figure = (label: string) => (new RegExp(`^${label} +(.+)$`, "m").exec(printed)?.[1] ?? "");
check("the elapsed figure it prints is this sitting alone", true, /^\d+s$/.test(figure("Time")));
check("and the conversation it reopened is the row under it", true, /^\d+h( \d+m)?$/.test(figure("History")));
check("set off by a blank line from the frame the harness restored", true,
  printed.includes("\n\nSession   01a04900"));
// The harness prints a resume line of its own under the name it was installed
// as, saying what the block already said. It is swallowed as it is written, and
// this case is what notices a harness that changes its wording, because the
// operator would otherwise be the one to notice.
check("and the harness's own resume line never reaches the screen", false,
  printed.includes("To resume this session"));
// This project's own are two lines and the harness's would be a third.
check("leaving the two resume lines on it, this project's own", 2,
  printed.split("\n").filter((l) => /[Rr]esume/.test(l)).length);

// A session flag is the chat's and `lm` claims none of them, so the same session
// reopens without the subcommand in front. The closing block is the proof, because
// the harness computes it from the entries it loaded: a run that reopened nothing
// has nothing to count.
const noSubcommand = await quitAfterOpening((s, d) => `--session ${s} --session-dir ${d}`);
check("a session reopens without naming the chat first", true,
  BLOCK.every((l) => noSubcommand.printed.includes(l)));

// The other half of the same fixture: held where the harness keeps its own, the
// identifier resolves, and the line is the short one the operator reads above it.
// Only a live run says so, because the method that decides is one the harness
// ships and does not declare.
const atHome = await quitAfterOpening(() => "--session 01a04900-0000-7000-8000-00000000c0de", defaultSessions);
check("a session held where the harness keeps its own is resumed by its identifier", true,
  BLOCK.every((l) => atHome.printed.includes(l))
    && atHome.printed.includes("Resume this session with:\nlm --resume 01a04900-0000-7000-8000-00000000c0de"));
check("and names no file, which is the longer line for nothing", false,
  atHome.printed.includes(`lm --resume ${atHome.session}`));

// The command the block prints is the one the operator pastes, so it is run as
// printed rather than asserted as a string. The harness spells its own `--resume`
// without an argument and reads a stray word as a prompt, so an untranslated
// identifier opens the session picker and asks the model the identifier: the
// block is proof of neither, because a run that reopened nothing has no entries
// to count and one that asked would carry the request in the table.
const reopened = await quitAfterOpening(() => "--resume 01a04900-0000-7000-8000-00000000c0de", defaultSessions);
check("the command the block prints is what reopens that session", true,
  BLOCK.every((l) => reopened.printed.includes(l)));
check("and the identifier is not asked of the model on the way in", false,
  /Error|Retrying/.test(reopened.printed));
// The short form is the same word, and the harness spells that one without an
// argument too.
const shortForm = await quitAfterOpening(() => "-r 01a04900-0000-7000-8000-00000000c0de", defaultSessions);
check("and -r reopens it the same way", true,
  BLOCK.every((l) => shortForm.printed.includes(l)));

// A session that never reached the model reports nothing, and the harness's line
// is dropped all the same, because the wrap goes in before the block is built
// rather than after it. The first case is the control: with no block on the
// screen to read back, a chat that never opened would satisfy the second.
const askedNothing = await quitAfterOpening((s, d) => `--session ${s} --session-dir ${d}`, undefined,
  join(ROOT, "tests/fixtures/session-asked-nothing.jsonl"));
check("a session that asked nothing opens the chat like any other", true,
  askedNothing.printed.includes("for commands"));
check("and quitting it leaves no resume line on the screen, this project's or the harness's", 0,
  askedNothing.printed.split("\n").filter((l) => /[Rr]esume/.test(l)).length);

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
