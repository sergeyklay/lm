// node tests/chrome.mts
//
// What the chat's own header and status rows say. The layout is what a person
// reads on every launch, so the cases pin the slots rather than the colours: a
// theme is the operator's to change, and the position of the branch is not.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerLines, footerLines, threeSlots, shortenCwd, formatTokens, visibleWidth, version } from "../src/chrome.mts";

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

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
