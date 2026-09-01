// node tests/chrome.mts
//
// What the chat's own header and status rows say. The layout is what a person
// reads on every launch, so the cases pin the slots rather than the colours: a
// theme is the operator's to change, and the position of the branch is not.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { headerLines, footerLines, DoubleEscapeEditor, threeSlots, shortenCwd, formatTokens, formatDuration, summarize, summaryBlock, visibleWidth, version, dropHarnessResume, ownTitle, installChrome, silenceChangelog, rememberModel, rememberThinkingLevel, skillsLine, trustProject, type SessionLocation, type Sitting } from "../src/chrome.mts";
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

// What a launch that updated the harness says, and where it says it. The header
// is what the screen says on every frame; an update happened once, so it goes
// out as the harness's own system notice instead. `session_start` fires again
// for a reload, which installed nothing and must not be told it did.
function openChat(updated: string | undefined, reason: string = "startup", commands: any[] = []) {
  const notices: Array<[string, unknown]> = [];
  let rows: string[] = [];
  let editorFactory: ((tui: any, editorTheme: any, keybindings: any) => any) | undefined;
  const handlers: Record<string, (event: any, ctx: any) => void> = {};
  installChrome({
    on: (name: string, fn: (event: any, ctx: any) => void) => { handlers[name] = fn; },
    getCommands: () => commands,
  }, updated);
  handlers.session_start({ type: "session_start", reason }, {
    hasUI: true,
    cwd: ROOT,
    model: undefined,
    getContextUsage: () => undefined,
    sessionManager: { getCwd: () => ROOT, getEntries: () => [] },
    ui: {
      notify: (message: string, type: unknown) => notices.push([message, type]),
      setHeader: (factory: any) => { rows = factory(undefined, theme).render(); },
      setFooter: () => {},
      setEditorComponent: (factory: any) => { editorFactory = factory; },
    },
  });
  return { notices, rows, editorFactory, said: (prefix: string) => notices.filter(([m]) => m.startsWith(prefix)) };
}

const opened = openChat("0.84.4");
check("a launch that updated the harness says so through the harness's own notice", 1, opened.said("harness updated").length);
check("naming the version it moved to", "harness updated to 0.84.4", String(opened.said("harness updated")[0]?.[0]));
check("without telling the operator to restart", false, /restart|Run |update the/.test(String(opened.said("harness updated")[0]?.[0])));
check("at the level that prints it bare, claiming nothing is wrong", "info", String(opened.said("harness updated")[0]?.[1]));
check("and the header stays the two rows it always was", 2, opened.rows.length);
check("saying nothing about the harness itself", false, /harness/.test(plain(opened.rows.join("\n"))));
check("a launch that moved nothing says nothing about the harness", 0, openChat(undefined).said("harness updated").length);
check("and a reload, which installed nothing, does not repeat the notice", 0, openChat("0.84.4", "reload").said("harness updated").length);

// What the operator put in the two directories, counted off the commands the
// harness registers one per loaded skill. Both tiers are named at every count,
// because a tier left out of the line and a tier that was never read look the
// same on the screen, and the whole point of the line is to tell those apart.
const skill = (name: string, scope: string) => ({ name: `skill:${name}`, source: "skill", sourceInfo: { scope } });
check("the line names both tiers and what each held",
  "skills: 2 project, 3 user",
  skillsLine([skill("a", "project"), skill("b", "project"), skill("c", "user"), skill("d", "user"), skill("e", "user")]));
check("a tier that held nothing is a zero rather than a word left out",
  "skills: 0 project, 1 user", skillsLine([skill("c", "user")]));
check("and a session that found none still says so", "skills: 0 project, 0 user", skillsLine([]));
// `--skill` is a path the operator typed in the command they just ran, so it is
// a third group under the harness's own name for it, and only when there is one.
check("a path named on the command line is a group of its own",
  "skills: 1 project, 0 user, 2 path",
  skillsLine([skill("a", "project"), skill("t", "temporary"), skill("u", "temporary")]));
// The commands are every kind the harness registers, and a prompt template is
// not a skill however much its record looks like one.
check("and nothing but a skill is counted",
  "skills: 0 project, 0 user",
  skillsLine([{ name: "x", source: "prompt", sourceInfo: { scope: "project" } },
              { name: "y", source: "extension", sourceInfo: { scope: "user" } }]));

const loaded = openChat(undefined, "startup", [skill("a", "project"), skill("c", "user"), skill("d", "user")]);
check("the launch says what it loaded, through the same notice", 1, loaded.said("skills:").length);
check("naming each tier and its count", "skills: 1 project, 2 user", String(loaded.said("skills:")[0]?.[0]));
check("at the level that claims nothing is wrong", "info", String(loaded.said("skills:")[0]?.[1]));
check("a launch that found none says so rather than saying nothing",
  "skills: 0 project, 0 user", String(openChat(undefined).said("skills:")[0]?.[0]));
check("and a reload, which is the same session, does not repeat it",
  0, openChat(undefined, "reload", [skill("a", "project")]).said("skills:").length);

// The harness asks before it reads a project's own resources, and answers of its
// own for a session with no dialog: `ask`, its default, drops them. This answers
// for the operator standing in the directory, and stands aside for a decision
// they recorded through the harness themselves.
function trustAnswers(agentDir: string, cwd: string) {
  const handlers: Array<(event: any) => any> = [];
  trustProject({ on: (name: string, fn: (event: any) => any) => { if (name === "project_trust") handlers.push(fn); } });
  const was = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try { return handlers.map((fn) => fn({ type: "project_trust", cwd })); }
  finally { if (was === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = was; }
}
const trustDir = mkdtempSync(join(tmpdir(), "lm-trust-"));
const trustCwd = join(trustDir, "project");
mkdirSync(trustCwd);
check("one handler answers the trust question and nothing else does",
  1, trustAnswers(trustDir, trustCwd).length);
check("with nothing recorded, the project is trusted rather than dropped",
  [{ trusted: "yes" }], trustAnswers(trustDir, trustCwd));
check("and nothing is written where the harness keeps its own answers",
  false, existsSync(join(trustDir, "trust.json")));
writeFileSync(join(trustDir, "trust.json"), JSON.stringify({ [trustCwd]: false }));
check("a refusal the operator recorded is left to stand",
  [{ trusted: "undecided" }], trustAnswers(trustDir, trustCwd));
writeFileSync(join(trustDir, "trust.json"), JSON.stringify({ [trustCwd]: true }));
check("and so is an approval, which the harness reads back for itself",
  [{ trusted: "undecided" }], trustAnswers(trustDir, trustCwd));
rmSync(trustDir, { recursive: true, force: true });

// The press the harness spends on nothing. With text in the editor and no answer
// in flight every branch of its own escape chain declines, so the second press
// inside the window is free and takes the editor's text. The decision is the
// chunk, the editor's own state and the clock, so these drive the real subclass
// against a stub terminal and a clock they hold still, rather than through a pty.
// `onEscape` stands in for the handler the harness assigns: the production class
// leaves the property undefined, which is what keeps the abort wired.
// `app.interrupt` is the one action the parent asks about on every chunk it is
// handed, so the stub's answers double as the record of which presses got there.
function chatEditor(text: string = "") {
  const parent: string[] = [];
  const editor = openChat(undefined).editorFactory!(
    { requestRender: () => {}, invalidate: () => {}, terminal: { setTitle: () => {} } },
    { borderColor: undefined },
    {
      matches: (data: string, action: string) => {
        if (action === "app.interrupt") parent.push(data);
        return action === "app.interrupt" && data === "\x1b";
      },
    },
  );
  const aborts: string[] = [];
  editor.onEscape = () => aborts.push("abort");
  editor.setText(text);
  let clock = 1_700_000_000_000;
  const press = (chunk: string, elapsed: number = 0) => {
    clock += elapsed;
    const real = Date.now;
    Date.now = () => clock;
    try { editor.handleInput(chunk); } finally { Date.now = real; }
  };
  return { editor, aborts, parent, press };
}

check("the chat installs an editor of its own", true, chatEditor().editor instanceof DoubleEscapeEditor);

const onePress = chatEditor("hello escape probe");
onePress.press("\x1b");
check("a single Esc leaves the text where it is", "hello escape probe", onePress.editor.getText());
check("and reaches the handler that aborts an answer in flight", 1, onePress.aborts.length);

const doublePress = chatEditor("hello escape probe");
doublePress.press("\x1b");
doublePress.press("\x1b", 250);
check("a second Esc inside the window clears the editor", "", doublePress.editor.getText());
check("and only the first press was spent on the abort", 1, doublePress.aborts.length);

const slowPress = chatEditor("hello escape probe");
slowPress.press("\x1b");
slowPress.press("\x1b", 1000);
check("two presses a second apart are two aborts, not a clear", "hello escape probe", slowPress.editor.getText());
check("and both reached the abort", 2, slowPress.aborts.length);

const popup = chatEditor("/co");
(popup.editor as any).autocompleteState = "auto";
popup.press("\x1b");
popup.press("\x1b", 250);
check("an open autocomplete owns the key, so the text survives", "/co", popup.editor.getText());
check("and both presses went on to the popup rather than being swallowed", 2, popup.parent.length);

// tmux writes a double tap as one chunk, which the harness's own double-escape
// misses; a whole-chunk comparison against one escape would inherit that.
const merged = chatEditor("hello escape probe");
merged.press("\x1b\x1b");
check("two escapes in one chunk clear the editor", "", merged.editor.getText());

const sequence = chatEditor("hello escape probe");
sequence.press("\x1b[A");
sequence.press("\x1b", 10);
check("an escape that opens a longer sequence is not a press", "hello escape probe", sequence.editor.getText());

const empty = chatEditor("");
empty.press("\x1b");
check("an Esc on an empty editor is handed to the parent rather than swallowed", 1, empty.aborts.length);
empty.editor.setText("a draft the abort put back");
empty.press("\x1b", 10);
check("and armed nothing, so a draft the abort restored survives the next press",
  "a draft the abort put back", empty.editor.getText());

const rearm = chatEditor("hello escape probe");
rearm.press("\x1b");
rearm.press("\x1b", 250);
rearm.editor.setText("typed again");
rearm.press("\x1b", 10);
check("a clear disarms the window, so the next single press is an abort again",
  "typed again", rearm.editor.getText());

// The harness greets the operator with its own release notes when the version it
// finds recorded is older than the one it runs, and this project is what moved
// it. So the version is recorded when this launch installed it, and only then: a
// harness that moved some other way keeps the greeting it earned.
function recordChangelog(stored: string | undefined, updated: string | undefined): string[] {
  const writes: string[] = [];
  silenceChangelog(
    { getLastChangelogVersion: () => stored, setLastChangelogVersion: (v: string) => writes.push(v) },
    updated,
  );
  return writes;
}
check("a launch that installed a version records it, so its notes never greet the operator",
  ["0.84.4"], recordChangelog("0.84.3", "0.84.4"));
check("a version already recorded is not written a second time", [], recordChangelog("0.84.4", "0.84.4"));
check("a launch that installed nothing never writes over the version already there", [],
  recordChangelog("0.84.3", undefined));
check("nor over a machine that has none, which the harness records for itself", [],
  recordChangelog(undefined, undefined));
check("and a settings file that cannot be read leaves the chat opening", [], (() => {
  const writes: string[] = [];
  silenceChangelog(
    { getLastChangelogVersion: () => { throw new Error("unreadable"); }, setLastChangelogVersion: (v: string) => writes.push(v) },
    "0.84.4",
  );
  return writes;
})());

// Which version a launch installs, off the registry. The range `package.json`
// declares is the whole of the policy, so the arithmetic is pinned against a
// list of releases rather than against what npm happens to be publishing.
check("the newest release the range admits is the target", "0.84.4",
  pickTarget(["0.83.9", "0.84.3", "0.84.4", "0.85.0", "1.0.0"], "^0.84.3", "0.84.3"));
check("a newer release outside the range is refused", undefined,
  pickTarget(["0.85.0", "1.0.0"], "^0.84.3", "0.84.3"));
check("and nothing moves when the newest in range is already installed", undefined,
  pickTarget(["0.84.3", "0.84.4", "0.85.0"], "^0.84.3", "0.84.4"));

// A clone the chat has never opened in: a real one installs the newest the range
// admits on every launch, so it has nothing left for these cases to move it to.
const behindDir = mkdtempSync(join(tmpdir(), "lm-clone-"));
const behindHarness = join(behindDir, "node_modules", "@earendil-works", "pi-coding-agent");
mkdirSync(behindHarness, { recursive: true });
writeFileSync(join(behindDir, "package.json"),
  JSON.stringify({ dependencies: { "@earendil-works/pi-coding-agent": "^0.84.3" } }));
writeFileSync(join(behindHarness, "package.json"), JSON.stringify({ version: "0.84.3" }));
const behind = pathToFileURL(`${behindDir}/`);

const npm: string[] = [];
check("a launch installs the target and reports the version it moved to", "0.84.4",
  await updateHarness({ clone: behind, published: async () => ["0.84.3", "0.84.4", "0.85.0"], install: (v) => { npm.push(v); return true; } }));
check("naming that version to npm and no other", ["0.84.4"], npm);
check("a launch already on the newest in range reports nothing", undefined,
  await updateHarness({ clone: behind, published: async () => ["0.84.3"], install: () => true }));

// Every way this can fail leaves the chat opening on the version installed, with
// nothing printed and nothing thrown: an update that did not happen is not news.
check("PI_OFFLINE asks the registry nothing at all", undefined,
  await updateHarness({ clone: behind, allowNetwork: false, published: async () => { throw new Error("asked"); }, install: () => true })
    .catch((e) => `threw ${e}`));
check("a registry that cannot be reached is silent rather than an error", undefined,
  await updateHarness({ clone: behind, published: async () => { throw new Error("no route to host"); }, install: () => true })
    .catch((e) => `threw ${e}`));
check("a registry answering rubbish is silent too", undefined,
  await updateHarness({ clone: behind, published: async () => ["not a version"], install: () => true })
    .catch((e) => `threw ${e}`));
check("and an install that fails reports no version", undefined,
  await updateHarness({ clone: behind, published: async () => ["0.84.4"], install: () => false })
    .catch((e) => `threw ${e}`));
rmSync(behindDir, { recursive: true, force: true });

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

// The same, for the version the harness compares its own release notes against,
// and against the harness's own settings file rather than a stand-in: the two
// accessors are its API, and a fake agreeing with itself would not notice them
// moving.
const changelog = (updated: string) =>
  spawnSync(process.execPath, ["-e",
    'Promise.all([import("./src/chrome.mts"), import("@earendil-works/pi-coding-agent")])' +
    `.then(([m, pi]) => m.silenceChangelog(pi.SettingsManager.create(process.cwd()), ${JSON.stringify(updated)}))`], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  });

changelog("0.84.4");
check("the version a launch installed is recorded where the harness reads it", "0.84.4",
  JSON.parse(readFileSync(settingsFile, "utf8")).lastChangelogVersion);
check("and the setting beside it is left as it was", "light",
  JSON.parse(readFileSync(settingsFile, "utf8")).theme);
const recorded = statSync(settingsFile).mtimeMs;
changelog("0.84.4");
check("recording the same version again does not touch the file", recorded, statSync(settingsFile).mtimeMs);

// What the chat remembers, and where it writes it. The harness saves neither
// half by itself: a model only under the keystroke in its own dialog, and a
// level not at all. So the cases drive the two events the harness does send,
// against its own settings file in the scratch directory above, and read the
// file back. Its writes are queued, so what reached disk is polled for rather
// than assumed.
function chatOn(saved: Record<string, unknown>, model: { provider: string; id: string } | undefined) {
  writeFileSync(settingsFile, JSON.stringify(saved));
  const handlers: Record<string, (event: any, ctx: any) => void> = {};
  installChrome({ on: (name: string, fn: (event: any, ctx: any) => void) => { handlers[name] = fn; }, getCommands: () => [] });
  let render: (width: number) => string[] = () => [];
  const ctx = {
    hasUI: true,
    cwd: ROOT,
    model,
    getContextUsage: () => undefined,
    sessionManager: { getCwd: () => ROOT, getEntries: () => [] },
    ui: {
      notify: () => {},
      setHeader: () => {},
      setFooter: (factory: any) => { render = factory(undefined, theme, { getGitBranch: () => null }).render; },
      setEditorComponent: () => {},
    },
  };
  handlers.session_start({ type: "session_start", reason: "startup" }, ctx);
  // Through the table rather than by name: an event the chat stopped listening
  // for has to fail the case that reads what the handler wrote, not abort the
  // suite on the way to it.
  const fire = (name: string, event: any) => handlers[name]?.(event, ctx);
  // The row is the directory, the padding, then the slot this is about.
  const statusModel = () => plain(render(78)[0]).trimEnd().split(/ {3,}/).pop() ?? "";
  return { handlers, fire, statusModel };
}

async function settled(want: (settings: any) => boolean): Promise<any> {
  for (let i = 0; i < 200; i += 1) {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    if (want(settings)) return settings;
    await new Promise((r) => setTimeout(r, 10));
  }
  return JSON.parse(readFileSync(settingsFile, "utf8"));
}

process.env.PI_CODING_AGENT_DIR = agentDir;

// The row says what the session is on and nothing about what the next launch
// will open on, because the chat now opens on this: there is nothing left to
// warn about, and a mark drawn on every frame to say so would be noise.
check("the status row carries the model and nothing beside it", "gpt-oss:20b",
  chatOn({ quietStartup: true }, { provider: "ollama", id: "gpt-oss:20b" }).statusModel());
check("and says the same where the file already remembers that model", "gpt-oss:20b",
  chatOn({ quietStartup: true, defaultProvider: "ollama", defaultModel: "gpt-oss:20b" },
    { provider: "ollama", id: "gpt-oss:20b" }).statusModel());

const picked = chatOn({ quietStartup: true }, { provider: "ollama", id: "phi3:mini" });
check("the chat listens for both of the choices the harness announces and saves neither of",
  ["model_select", "session_shutdown", "session_start", "thinking_level_select"],
  Object.keys(picked.handlers).sort());
picked.fire("model_select", { type: "model_select", model: { provider: "ollama", id: "gpt-oss:20b" }, source: "set" });
const afterModel = await settled((settings) => settings.defaultModel !== undefined);
check("a model change is remembered as the model the next launch opens on", "gpt-oss:20b",
  afterModel.defaultModel);
check("under the provider serving it, which is the other half of what names a model", "ollama",
  afterModel.defaultProvider);

// A level names no model, so it is remembered under the model in force. The
// harness prefers that entry over its own global default at every launch, which
// is what makes the level come back with the model rather than with the chat.
const onGpt = chatOn({ quietStartup: true, defaultProvider: "ollama", defaultModel: "gpt-oss:20b" },
  { provider: "ollama", id: "gpt-oss:20b" });
onGpt.fire("thinking_level_select", { type: "thinking_level_select", level: "high", previousLevel: "low" });
const afterLevel = await settled((settings) => settings.modelThinkingLevels !== undefined);
check("a thinking level is remembered under the model it belongs to", "high",
  afterLevel.modelThinkingLevels?.["ollama/gpt-oss:20b"]);
check("and under that model alone", ["ollama/gpt-oss:20b"], Object.keys(afterLevel.modelThinkingLevels ?? {}));
check("rather than as the default the harness would then apply to every model", false,
  "defaultThinkingLevel" in afterLevel);

const onPhi = chatOn({ ...afterLevel, quietStartup: true }, { provider: "ollama", id: "phi3:mini" });
onPhi.fire("thinking_level_select", { type: "thinking_level_select", level: "off", previousLevel: "high" });
const afterBoth = await settled((settings) => settings.modelThinkingLevels?.["ollama/phi3:mini"] !== undefined);
check("a second model's level is remembered beside the first and not over it", "high|off",
  `${afterBoth.modelThinkingLevels?.["ollama/gpt-oss:20b"]}|${afterBoth.modelThinkingLevels?.["ollama/phi3:mini"]}`);

// Both halves of a choice have to be there to be worth writing: a settings file
// asked to remember half of one is a file naming a model nothing can resolve.
const asked: string[] = [];
const recorder = {
  setDefaultModelAndProvider: (provider: string, model: string) => asked.push(`model ${provider}/${model}`),
  setModelThinkingLevel: (provider: string, model: string, level: string) =>
    asked.push(`level ${provider}/${model}=${level}`),
};
rememberModel(recorder, undefined);
rememberThinkingLevel(recorder, { provider: "ollama", id: "gpt-oss:20b" }, undefined);
rememberThinkingLevel(recorder, undefined, "high");
check("a change naming no model, or no level, is not remembered", [], asked);
rememberModel(recorder, { provider: "ollama", id: "gpt-oss:20b" });
rememberThinkingLevel(recorder, { provider: "ollama", id: "gpt-oss:20b" }, "high");
check("and one naming both is", ["model ollama/gpt-oss:20b", "level ollama/gpt-oss:20b=high"], asked);

delete process.env.PI_CODING_AGENT_DIR;

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
// The width is the terminal's, so every case here hands the block one rather
// than reading the terminal the suite happens to be running on.
const block = (es: any[], h: any = head, sitting: Sitting = OPENED, where: SessionLocation = HOME,
  screenWidth: number | undefined = 80) => {
  const s = summarize(h, es, sitting, where);
  return s === null ? null : summaryBlock(s, undefined, screenWidth).join("\n");
};
// What a row says and what encloses it are two properties, so the cases below
// read the content back through the frame and the frame has cases of its own.
const unframe = (text: string) => text.split("\n")
  .filter((l) => !/^[┌└]/.test(l))
  .map((l) => (/^│ {2}/.test(l) ? l.replace(/^│ {2}/, "").replace(/ {2}│$/, "").trimEnd() : l))
  .join("\n");
const part = (text: string | null, n: number) =>
  unframe(String(text)).replace(/^\n+|\n+$/g, "").split("\n\n")[n];
// What the operator would select: the row under the heading and every row a
// continuation carries on to.
function resumeRows(text: string): string {
  const rest = unframe(text).split("Resume\n")[1]?.split("\n") ?? [];
  const rows: string[] = [];
  for (const line of rest) {
    rows.push(line);
    if (!line.endsWith("\\")) break;
  }
  return rows.join("\n");
}
// Those rows are a command, so what they carry is read by running them rather
// than by rejoining them here: a shell reading its own continuations back is the
// only witness that a path broken across rows still names the session.
const pasted = (text: string) =>
  spawnSync("bash", ["-c", resumeRows(text).replace(/^lm --resume /, "printf %s ")], { encoding: "utf8" }).stdout;

check("the block opens on the session, what it ran and how long it took",
  "Summary\nSession       01a04900-0000-7000-8000-00000000c0de\n"
  + "Tools         3 ran, 1 failed\nTime          12m 30s",
  part(block(entries), 0));
check("the table charges the spend to the model that answered",
  "Spend\nModel         Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────────\nqwen3.8:27b      3   37.0k    3.0k     1.2k",
  part(block(entries), 1));
check("and it closes on the command that reopens the session, over two lines",
  "Resume\nlm --resume 01a04900-0000-7000-8000-00000000c0de", part(block(entries), 2));
// The heading of one section and the figures of the next begin in the same
// column, so the block reads down one edge rather than three.
check("the figures and the model names begin in the same column", true,
  part(block(entries), 0).split("\n")[1].indexOf("01a04900")
    === part(block(entries), 1).split("\n")[1].indexOf("Reqs"));
// The identifier is the shorter line and the one the operator reads on the row
// above, but it resolves in one directory. A session kept anywhere else is named
// by its file, which reopens it wherever it is.
// The file form is wider than the row by construction, since the basename the
// harness builds is 67 of the 80 on its own, and it is a command to paste rather
// than a figure to read: it is broken with the shell's own continuation instead
// of being shortened, because a path that no longer opens the session costs more
// than a ragged screen.
const AWAY_COMMAND = "lm --resume /srv/sessions/2026-08-28T20-00-00-000Z_01a04900-0000-7000-800\\\n"
  + "0-00000000c0de.jsonl";
check("a session outside that directory is named by its file instead",
  `Resume\n${AWAY_COMMAND}`, part(block(entries, head, OPENED, AWAY), 2));
check("and a shell reading that back names the file the session is held in",
  AWAY.file, pasted(String(block(entries, head, OPENED, AWAY))));
// The harness declares no method that answers this, so a build that stops
// shipping one leaves the question open, and an open question takes the file.
check("and a directory the harness will not answer for takes the file too",
  `Resume\n${AWAY_COMMAND}`,
  part(block(entries, head, OPENED, { file: AWAY.file, isDefaultDir: undefined }), 2));
check("but with no file to name it falls back to the identifier",
  "Resume\nlm --resume 01a04900-0000-7000-8000-00000000c0de",
  part(block(entries, head, OPENED, { file: undefined, isDefaultDir: undefined }), 2));
// The line is pasted into a shell, so a path that is more than one word there is
// quoted rather than printed as a command that would open something else.
check("a path a shell would split is quoted",
  "Resume\nlm --resume '/srv/my sessions/a.jsonl'",
  part(block(entries, head, OPENED, { file: "/srv/my sessions/a.jsonl", isDefaultDir: false }), 2));
// A backslash inside single quotes is a backslash rather than a break, so a
// quoted path is broken into one quoted piece per row, which the shell joins
// into the single word it was.
const SPACED = "/srv/my sessions/2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl";
const spacedBlock = String(block(entries, head, OPENED, { file: SPACED, isDefaultDir: false }));
check("a quoted path too wide for the row is broken into quoted pieces",
  "Resume\n"
  + "lm --resume '/srv/my sessions/2026-08-28T20-00-00-000Z_01a04900-0000-700'\\\n"
  + "0-8000-00000000c0de.jsonl",
  part(spacedBlock, 2));
check("and a shell reading that back names the file with its space intact", SPACED, pasted(spacedBlock));

// The two rows that can outgrow the block are the resume command and the model
// column, so the width is read over a block carrying both at once.
const WIDE = "hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M";
const retag = (es: any[], model: string) =>
  es.map((e) => (e.message?.model ? { ...e, message: { ...e.message, model } } : e));
check("every row of it reads on an eighty-column terminal", true,
  String(block(entries)).split("\n").every((l) => visibleWidth(l) <= 80));
check("and so does one naming the session by its file and the model by a 54-character identifier",
  true, String(block(retag(entries, WIDE), head, OPENED, AWAY)).split("\n").every((l) => visibleWidth(l) <= 80));

// Eighty is what there is to fall back on rather than a bound: the block takes
// the width the terminal reports, so the one row the operator pastes is a single
// row again wherever the terminal is wide enough to hold it.
const WIDE_TERMINAL = 100;
check("a terminal wider than the command leaves it on one row",
  `Resume\nlm --resume ${AWAY.file}`,
  part(block(entries, head, OPENED, AWAY, WIDE_TERMINAL), 2));
// Every other column is already as wide as its own widest cell, so the model
// column is the only one a wider terminal changes.
check("and the model column is given the room that terminal leaves it", true,
  part(block(retag(entries, WIDE), head, OPENED, AWAY, WIDE_TERMINAL), 1).includes(WIDE));

// There is nothing to ask when stdout is not a terminal, which is what a pipe, a
// redirect and CI are. A pty nobody gave a size to reports zero, and zero is the
// same answer as none. The block is reached without the helper above, because a
// default argument stands in for the width that was never reported and the case
// would be asking about the helper rather than about the block.
const bounded = (screenWidth?: number) => {
  const s = summarize(head, entries, OPENED, AWAY);
  return s === null ? "" : summaryBlock(s, undefined, screenWidth).join("\n");
};
const EIGHTY = bounded(80);
check("with no terminal to report a width the block is the eighty-column one", EIGHTY, bounded());
check("and a terminal reporting no size at all is read the same way", EIGHTY, bounded(0));

// Narrower than the shell's own continuation can work in, the command comes out
// a character of the path to the row, which no paste rejoins. Twenty is where
// that stops, the floor the harness puts under its own width.
const narrow = bounded(5);
check("a width under twenty is floored there", bounded(20), narrow);
const carried = (row: string) => row.replace(/^lm --resume /, "").replace(/\\$/, "");
check("and every row of the command it breaks carries more than one character of the path", true,
  resumeRows(narrow).split("\n").every((l) => carried(l).length > 1));
check("and the table's model column is the shared one wide rather than a negative width",
  "Spend\nModel     Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────\nqwe\u202627b      3   37.0k    3.0k     1.2k", part(narrow, 1));
check("and a shell reading it back still names the file", AWAY.file, pasted(narrow));

// The frame is one border around the whole block with a column of padding inside
// it. It costs six of the terminal's columns, so it is drawn against the room it
// leaves rather than against the terminal: a row sized to the terminal would
// cross the border it was supposed to sit inside.
const FRAMED = String(block(entries, head, OPENED, AWAY));
check("the block is drawn inside one frame", true,
  FRAMED.startsWith("┌") && FRAMED.endsWith("┘") && FRAMED.split("\n").filter((l) => /^[┌└]/.test(l)).length === 2);
check("every row of which is exactly the width the terminal reported", [80],
  [...new Set(FRAMED.split("\n").map(visibleWidth))]);
check("and every row between the borders is a side, a column of padding and a side", true,
  FRAMED.split("\n").slice(1, -1).every((l) => /^│ {2}.* {2}│$/.test(l)));
check("set off from the border by a blank row under it and another above the foot", true,
  [1, -2].map((i) => FRAMED.split("\n").at(i) ?? "").every((l) => /^│ +│$/.test(l)));
// The two rows that cannot be shortened are a model identifier elided to fit and
// a resume command broken to fit, so the bound is read over a block carrying
// both against the room the frame leaves them rather than the terminal.
check("a fifty-four-character model identifier is elided against the frame's interior", [80],
  [...new Set(String(block(retag(entries, WIDE), head, OPENED, AWAY)).split("\n").map(visibleWidth))]);
// Below the floor the contents are sized against, the resume command comes out a
// character of the path to the row; above it, a row that cannot shrink that far
// would still cross the border. Either way the block goes out without a frame,
// which is what it did before there was one.
const WIDTHS = [20, 26, 40, 60, 80, 100, 200];
const isFramed = (w: number) => bounded(w).startsWith("┌");
check("a terminal that cannot hold the frame is given the block without one",
  [20, 26, 40], WIDTHS.filter((w) => !isFramed(w)));
check("and wherever it is drawn it bounds every row to the terminal it was drawn for", true,
  WIDTHS.filter(isFramed).every((w) => bounded(w).split("\n").every((l) => visibleWidth(l) === w)));

// Which width the block is handed is the shutdown handler's answer, and only the
// handler says so: the block itself takes whatever it is given. The read happens
// where the block is written, after the harness has stopped the TUI, because the
// width a render callback is handed is out of scope by then.
function quitWithColumns(columns: number | undefined): string {
  const handlers: Record<string, (event: any, ctx: any) => void> = {};
  installChrome({ on: (name: string, fn: (event: any, ctx: any) => void) => { handlers[name] = fn; }, getCommands: () => [] });
  const out = process.stdout as any;
  const [reported, wrote] = [out.columns, out.write];
  const written: string[] = [];
  out.columns = columns;
  out.write = (chunk: unknown) => { written.push(String(chunk)); return true; };
  try {
    handlers.session_shutdown({ type: "session_shutdown", reason: "quit" }, {
      hasUI: true,
      sessionManager: {
        getHeader: () => head,
        getEntries: () => entries,
        getSessionFile: () => AWAY.file,
        usesDefaultSessionDir: () => false,
      },
    });
  } finally {
    out.write = wrote;
    out.columns = reported;
  }
  return written.join("");
}
check("the handler bounds the block by the width the terminal it writes to reports",
  `lm --resume ${AWAY.file}`, resumeRows(quitWithColumns(WIDE_TERMINAL)));
check("and by eighty when that terminal reports nothing",
  resumeRows(EIGHTY), resumeRows(quitWithColumns(undefined)));

// The block is written once the harness has stopped the TUI, where the theme a
// render callback is handed is gone, so what it draws with arrives as an
// argument rather than being read in here. The glyphs are its own and only their
// colour is the theme's, as the header's mark already is.
const INK = {
  bold: (text: string) => theme.bold(theme.fg("text", text)),
  accent: (text: string) => theme.fg("accent", text),
  border: (text: string) => theme.fg("borderAccent", text),
};
const rowsOf = (ink?: typeof INK) => {
  const s = summarize(head, entries, OPENED, HOME);
  return s === null ? [] : summaryBlock(s, ink, 80);
};
const coloured = rowsOf(INK);
const rowOf = (label: string) => coloured.find((l) => plain(l).includes(label)) ?? "";
check("each section is headed in bold", true,
  ["Summary", "Spend", "Resume"].every((h) => rowOf(h).includes("\x1b[1m")));
// The line the operator pastes is the one thing here that leaves the screen for
// a shell, so it is the accent rather than the dimmest ink there is.
check("the command that reopens the session is in the accent colour", true,
  styled(rowOf("lm --resume"), "accent"));
check("rather than in the dimmest ink on the screen", false, styled(rowOf("lm --resume"), "dim"));
check("the frame and the rule under the table's header wear the border colour", true,
  [coloured[0], coloured.at(-1) ?? "", coloured.find((l) => plain(l).startsWith("│") && plain(l).includes("───")) ?? ""]
    .every((l) => styled(l, "borderAccent")));
// Nothing that carries a figure is coloured, because a colour on a count is a
// claim about it and none of these counts is divided by another.
check("and the figures between them carry no colour of their own", true,
  ["3 ran, 1 failed", "qwen3.8:27b", "01a04900"].every((c) => {
    const row = rowOf(c);
    return row !== "" && !row.includes("\x1b[1m") && !styled(row, "accent") && !styled(row, "dim");
  }));
check("the words are the same ones a terminal without colour reads",
  rowsOf().join("\n"), coloured.map(plain).join("\n"));
check("and with no colour to spend the block is printed as text", true,
  rowsOf().every((l) => l === plain(l)));

// A zero the operator cannot see is a feature they cannot tell from one that was
// never built, which is what the suppressed clauses cost. Both counts are printed
// whatever they are.
const worked = entries.map((e) =>
  e.message?.role === "toolResult" ? { ...e, message: { ...e.message, isError: false } } : e);
const toolRow = (text: string | null) => part(text, 0).split("\n")[2];
check("a session whose tools all worked prints the failure count as a zero",
  "Tools         3 ran, 0 failed", toolRow(block(worked)));
check("a session that ran no tool prints both counts as zeroes",
  "Tools         0 ran, 0 failed",
  toolRow(block(entries.filter((e) => e.message?.role !== "toolResult"))));

// One model is one row, and a total row would repeat it. Two models are two rows
// and a sum the reader would otherwise do by hand.
const two = load(join(ROOT, "tests/fixtures/session-two-models.jsonl"));
check("a second model gets a row of its own and a total under both",
  "Spend\nModel         Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────────\n"
  + "qwen3.8:27b      2    8.0k    1.0k      300\n"
  + "gpt-oss:20b      1    2.0k     500      150\n"
  + "total            3   10.0k    1.5k      450",
  part(block(two.entries, two.head), 1));
check("and the columns are still as wide as the widest cell in them", true,
  part(block(two.entries, two.head), 1).split("\n").slice(1).every((l) => l.length === 43));

// Until one cell outgrows what the four fixed columns leave it. The identifier
// is elided in the middle rather than cut, because the tail is what tells one
// quantization of a model from another and a cut would drop it.
check("a model identifier wider than the table allows is elided in the middle",
  "Spend\nModel                                        Reqs   Input   Cache   Output\n"
  + "──────────────────────────────────────────────────────────────────────────\n"
  + "hf.co/unsloth/Qwen3-C…Instruct-GGUF:Q4_K_M      3   37.0k    3.0k     1.2k",
  part(block(retag(entries, WIDE)), 1));
const quantized = two.entries.map((e) => (e.message?.model
  ? { ...e, message: { ...e.message, model: e.message.model === "qwen3.8:27b" ? WIDE : `${WIDE.slice(0, -6)}Q8_0` } }
  : e));
const quantTable = part(block(quantized, two.head), 1).split("\n").slice(1);
check("two identifiers sharing a prefix are still told apart",
  2, new Set(quantTable.slice(2, 4).map((l) => l.slice(0, quantTable[0].indexOf("Reqs")))).size);
check("and the total row still lines up under both", true,
  quantTable.every((l) => l.length === 74));

const at = (ms: number, message: any) => ({ type: "message", timestamp: new Date(ms).toISOString(), message });
const turn = (input: number, output: number) =>
  ({ role: "assistant", model: "qwen3.8:27b", usage: { input, output, cacheRead: 0, cacheWrite: 0 } });
const one = [at(1000, turn(500, 20)), at(4000, { role: "toolResult", toolName: "commit", isError: false })];
check("one tool is counted like any other", "Tools         1 ran, 0 failed",
  toolRow(block(one, { id: "01a04900-0000-7000-8000-00000000c0de", timestamp: new Date(1000).toISOString() })));

// A compaction is a model call, and its entry names no model, so the tokens it
// spent belong to whichever model was in force when it ran.
const compacted = [
  at(1000, turn(500, 20)),
  { type: "compaction", timestamp: new Date(2000).toISOString(), usage: { input: 100, output: 5 } },
];
check("a compaction is charged to the model in force when it ran",
  "Spend\nModel         Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────────\nqwen3.8:27b      1     600       0       25",
  part(block(compacted, null), 1));
check("and an answer that names no model is charged to no model rather than dropped",
  "Spend\nModel     Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────\nunknown      1     500       0       20",
  part(block([at(1000, { role: "assistant", usage: { input: 500, output: 20 } })], null), 1));
// The harness declares the model in an entry of its own before any reply carries
// one, so a compaction before that reply is charged to the model then in force.
const declared = [
  { type: "model_change", timestamp: new Date(500).toISOString(), modelId: "gpt-oss:20b" },
  { type: "compaction", timestamp: new Date(1000).toISOString(), usage: { input: 100, output: 5 } },
  at(2000, turn(500, 20)),
];
check("and a model declared before the first reply is charged for what ran under it",
  "Spend\nModel         Reqs   Input   Cache   Output\n"
  + "───────────────────────────────────────────\ngpt-oss:20b      0     100       0        5\n"
  + "qwen3.8:27b      1     500       0       20\ntotal            1     600       0       25",
  part(block(declared, null), 1));

// The first figure is this sitting, and a session this launch created opens it at
// its own record: the first entry is written after the model and the thinking
// level are settled, and the launch runs before the record exists.
const record = (ms: number) => ({ id: "01a04900-0000-7000-8000-00000000c0de", timestamp: new Date(ms).toISOString() });
check("the span opens at the session record rather than at the first entry",
  "Time          1m 30s",
  part(block([at(62_000, turn(500, 20))], record(2000), { launchedAt: 1000, endedAt: 92_000 }), 0).split("\n")[3]);
// A session older than the launch was reopened, so what this sitting cost and
// what the whole conversation cost are two facts and get a row each.
check("a session opened before this launch reports the sitting and the conversation under it",
  "Time          2m\nHistory       12m 30s",
  part(block(entries, head, { launchedAt: RECORD + 750_000, endedAt: RECORD + 870_000 }), 0).split("\n").slice(3).join("\n"));
check("and a session this launch opened reports the sitting alone", false,
  String(block(entries)).includes("History"));
check("and opens the sitting at the launch when there is no session record",
  "Summary\nTools         0 ran, 0 failed\nTime          1m",
  part(block([at(60_000, turn(500, 20))], null, { launchedAt: 30_000, endedAt: 90_000 }), 0));
// Without a session record there is no identifier, and a resume command naming
// none would not reopen anything.
check("which also leaves nothing to resume", 2,
  unframe(String(block([at(60_000, turn(500, 20))], null, { launchedAt: 30_000, endedAt: 90_000 })))
    .replace(/^\n+|\n+$/g, "").split("\n\n").length);

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

// Every title the harness paints leaves with this project's name in front of it,
// which is what makes the name survive a repaint nothing of this project's ran
// before. The chunk is matched whole, so the wrap has nothing to say about any
// other escape the harness writes.
const osc = (title: string) => `\x1b]0;${title}\x07`;
const titled: unknown[] = [];
const screen = { write: (chunk: unknown) => { titled.push(chunk); return true; } };
ownTitle(screen);
const owned = screen.write;
check("the harness's name is replaced by this project's", osc("lm - lm"),
  (screen.write(osc("π - lm")), String(titled.at(-1))));
check("and the session name it composed is left where it put it", osc("lm - a name - lm"),
  (screen.write(osc("π - a name - lm")), String(titled.at(-1))));
check("a chunk that is not a title is written as it came", "\x1b[2J",
  (screen.write("\x1b[2J"), String(titled.at(-1))));
check("and a title that arrived as bytes leaves as bytes", true,
  (screen.write(Buffer.from(osc("π - lm"))), Buffer.isBuffer(titled.at(-1))));
// `session_start` fires for every session and again for a reload, and the stream
// is the process's own: a second install would put a second wrap on every write
// the chat makes for the rest of the sitting.
ownTitle(screen);
check("a second install leaves the one wrap that is already there", true, screen.write === owned);

// The unit cases above say the block is right. This says the harness reaches the
// handler that prints it, on the quit path and to the terminal it has already
// restored, which no assertion over `summarize` can show.
// The model is never asked: nothing is submitted, the catalogue read is off and
// the endpoint points nowhere, so a chat that tried would fail rather than run.
async function quitAfterOpening(
  argv: (session: string, dir: string) => string,
  holds: (quit: string) => string = (quit) => quit,
  from: string = FIXTURE,
  drive?: (send: (keys: string) => void, until: (text: string) => Promise<string>) => Promise<void>,
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
  if (drive) {
    // The capture at the moment a thing appears, so a case reads the screen it
    // named rather than whatever the screen holds once the run is over.
    const until = async (text: string): Promise<string> => {
      const end = Date.now() + 30_000;
      while (Date.now() < end && !seen().includes(text)) await wait(200);
      return seen();
    };
    await drive((keys) => { chat.stdin.write(keys); }, until);
  }
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
const BLOCK = ["Session       01a04900-0000-7000-8000-00000000c0de", "Tools         3 ran, 1 failed",
  "Model         Reqs   Input   Cache   Output", "qwen3.8:27b      3   37.0k    3.0k     1.2k"];
check("quitting the chat prints the closing block on the restored terminal", true,
  BLOCK.every((l) => printed.includes(l)));
// The session is not in the directory an identifier resolves in, so the line
// names the file, which reopens it from wherever it is.
check("and a session held outside the default directory is resumed by its file", away,
  pasted(printed));
check("naming no identifier the chat could not have found it by", false,
  printed.includes("lm --resume 01a04900-0000-7000-8000-00000000c0de"));
// Every case here reads a capture the escapes have been stripped out of, so the
// colour is only visible in the one that was not. The theme is the harness's own
// and its grey is whatever the operator's theme says, so what is pinned is that
// the two lines were coloured and reset rather than which colour came out.
check("and the command it prints wears a colour the theme chose", true,
  /\x1b\[[0-9;]+mlm --resume [^\x1b]+\x1b\[39m/.test(raw));
check("which the block above them does not", false, /\x1b\[[0-9;]+mTools /.test(raw));
// The two figures differ only where a session outlived a launch, and this run is
// that: the fixture's own record is dated before any run of this suite, while the
// sitting is the seconds this case spends in the chat before ending it.
const figure = (label: string) => (new RegExp(`^│ +${label} +(.+?) +│$`, "m").exec(printed)?.[1] ?? "");
check("the elapsed figure it prints is this sitting alone", true, /^\d+s$/.test(figure("Time")));
check("and the conversation it reopened is the row under it", true, /^\d+h( \d+m)?$/.test(figure("History")));
check("set off by a blank line from the frame the harness restored", true,
  /\n\n┌─+┐\n/.test(printed));
// The harness prints a resume line of its own under the name it was installed
// as, saying what the block already said. It is swallowed as it is written, and
// this case is what notices a harness that changes its wording, because the
// operator would otherwise be the one to notice.
check("and the harness's own resume line never reaches the screen", false,
  printed.includes("To resume this session"));
// This project's own label and the first row of its command; the harness's
// would be a third.
check("leaving the two lines that say resume on it, this project's own", 2,
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
    && resumeRows(atHome.printed) === "lm --resume 01a04900-0000-7000-8000-00000000c0de");
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

// The window title is what the operator reads in a tab they are not looking at,
// and the harness repaints it after every handler that could set it: once on the
// way in, twice more on a session switch. So it is read back from the bytes the
// terminal received rather than from the process that wrote them, at launch and
// again after a `/new`, because a title that is only right at launch is worse
// than one this project never touched.
const OSC_TITLE = /\x1b\]0;([^\x07]*)\x07/g;
const titles = (capture: string): string[] => [...capture.matchAll(OSC_TITLE)].map((m) => m[1]);

let launched = "";
const switched = await quitAfterOpening(
  (s, d) => `chat --session ${s} --session-dir ${d}`, undefined, undefined,
  async (send, until) => {
    launched = await until("\x1b]0;");
    send("/new\r");
    await until("New session started");
  });
const WINDOW = `lm - ${basename(ROOT)}`;
check("the window title the terminal receives names this project", WINDOW,
  titles(launched).at(-1) ?? "no title reached the terminal");
// The control: without it a run whose keystroke never landed would satisfy the
// case below by reading the launch title a second time.
check("and a session switch is what the case below reads the title after", true,
  switched.printed.includes("New session started"));
check("which the title survives, because the harness repaints it after the switch", WINDOW,
  titles(switched.raw).at(-1) ?? "no title reached the terminal");
check("with the harness's own name on none of the titles the terminal received", [],
  titles(switched.raw).filter((t) => !t.startsWith("lm")));

if (fail) { console.log("FAILED"); process.exit(1); }
console.log("all cases passed");
