import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { CustomEditor, SettingsManager } from "@earendil-works/pi-coding-agent";

// The mark is block glyphs coloured from the theme rather than from RGB: a
// terminal without truecolor gets the theme's own approximation instead of a
// colour it cannot show.
const MARK = ["█ █▀█", "█ █ █"];

// A tag is what `git describe` reports and a clone has no tags, so the field in
// package.json is the only version a clone can read.
export function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

const ANSI = /\x1b\[[0-9;]*m/g;
export const visibleWidth = (s: string): number => Array.from(s.replace(ANSI, "")).length;

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

export function shortenCwd(cwd: string, home: string | undefined): string {
  if (!home || home === "/") return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

// Three slots on one line. The centre is the first to go when the width runs
// out, because a branch name is the one thing here the operator can also see in
// their prompt, and the right slot is the second.
export function threeSlots(width: number, left: string, centre: string, right: string): string {
  const [l, c, r] = [left, centre, right].map(visibleWidth);
  if (c > 0 && l + c + r + 2 <= width) {
    const start = Math.max(l + 1, Math.floor((width - c) / 2));
    return left + " ".repeat(start - l) + centre + " ".repeat(width - start - c - r) + right;
  }
  if (r > 0 && l + r + 2 <= width) return left + " ".repeat(width - l - r) + right;
  if (l <= width) return left;
  return Array.from(left.replace(ANSI, "")).slice(0, width).join("");
}

export type Chrome = {
  cwd: string;
  branch: string | null;
  model: string;
  contextTokens: number | null;
  contextWindow: number;
  autoCompact: boolean | undefined;
  input: number;
  output: number;
  thinking: string | undefined;
};

export function headerLines(theme: any): string[] {
  const v = version();
  const name = theme.bold(theme.fg("text", v ? `lm v${v}` : "lm"));
  const hint = theme.fg("dim", "/ for commands · @ for a file path · ! to run bash");
  return [
    `${theme.fg("accent", MARK[0])}  ${name}`,
    `${theme.fg("borderAccent", MARK[1])}  ${hint}`,
  ];
}

export function footerLines(theme: any, width: number, c: Chrome): string[] {
  const percent =
    c.contextTokens === null || c.contextWindow === 0
      ? "?"
      : `${((c.contextTokens / c.contextWindow) * 100).toFixed(1)}%`;
  // The label is only printed when the setting was actually read: claiming a
  // mode this cannot see would be worse than leaving the number bare.
  const auto = c.autoCompact === true ? " (auto)" : "";
  const context = `${percent}/${formatTokens(c.contextWindow)}${auto}`;
  const share = c.contextTokens === null || c.contextWindow === 0 ? 0 : (c.contextTokens / c.contextWindow) * 100;
  const contextColoured =
    share > 90 ? theme.fg("error", context) : share > 70 ? theme.fg("warning", context) : theme.fg("dim", context);

  const bold = (s: string) => theme.bold(theme.fg("text", s));
  // Both halves of the left slot are what the session has spent, so they sit
  // together and in the same grey. The model has the row above, where a name the
  // operator chose is the one thing here they cannot read anywhere else.
  const tokens = c.input || c.output
    ? theme.fg("dim", `↑${formatTokens(c.input)} ↓${formatTokens(c.output)}`)
    : "";
  const spent = tokens ? `${contextColoured}  ${tokens}` : contextColoured;
  // The level is the harness's own, and it is a claim about the request only for
  // a model declared as thinking. Declared otherwise, it is nailed to one value
  // whatever the model does, so the slot stays empty rather than saying it.
  const thinking = c.thinking ? theme.fg("dim", `think ${c.thinking}`) : "";

  return [
    threeSlots(width, bold(shortenCwd(c.cwd, homedir())), c.branch ? bold(c.branch) : "", bold(c.model)),
    threeSlots(width, spent, "", thinking),
  ];
}

// The harness lists the resources it loaded on every launch unless
// `quietStartup` is set, and there is no flag for it: its argument parser
// carries `--verbose` and no opposite. The chat is this program's own screen, so
// the setting is written once into the harness's own settings file and then left
// alone. Silently: a message about a setting the operator did not ask for is the
// noise this removes.
export function silenceStartup(): void {
  try {
    const settings = SettingsManager.create(process.cwd());
    if (settings.getQuietStartup() !== true) settings.setQuietStartup(true);
  } catch {
    // The chat opens either way.
  }
}

// The harness greets the operator with its own release notes whenever the
// version it finds recorded is older than the one it is running, and this
// project is what moved that version: an update nobody asked for should not cost
// a screen of notes on the next launch, and `/changelog` still shows them on
// request. So the version is recorded exactly when this launch is what installed
// it, and written once, as `silenceStartup` writes its own. A harness that moved
// some other way keeps its greeting, and a machine with nothing recorded is left
// alone: the harness records its own version there, shows nothing, and reports
// the install while it does.
export function silenceChangelog(
  settings: { getLastChangelogVersion(): unknown; setLastChangelogVersion(version: string): void },
  updated: string | undefined,
): void {
  try {
    if (updated !== undefined && settings.getLastChangelogVersion() !== updated) {
      settings.setLastChangelogVersion(updated);
    }
  } catch {
    // The chat opens either way.
  }
}

// A model is the pair, never the id alone: the harness resolves a remembered
// choice by provider and id together, and one provider's model is not another's
// however alike the two names read.
type Chosen = { provider: string; id: string };

// The chat opens on what it was last on, and the harness writes neither half of
// that by itself: it saves a model only under the keystroke in its own dialog,
// and `/thinking` saves nothing at all. So both are written here, each where the
// harness's own resolver reads it back.
export function rememberModel(
  settings: { setDefaultModelAndProvider(provider: string, model: string): void },
  model: Chosen | undefined,
): void {
  try {
    if (model) settings.setDefaultModelAndProvider(model.provider, model.id);
  } catch {
    // The chat carries on with the model the operator just chose.
  }
}

// Under the model the level belongs to rather than as the global default, which
// is what makes it the level that model comes back at: the harness prefers a
// per-model entry over its default, at launch and on every switch alike.
export function rememberThinkingLevel(
  settings: { setModelThinkingLevel(provider: string, model: string, level: string): void },
  model: Chosen | undefined,
  level: string | undefined,
): void {
  try {
    if (model && level) settings.setModelThinkingLevel(model.provider, model.id, level);
  } catch {
    // The chat carries on at the level the operator just chose.
  }
}

function compactionEnabled(cwd: string): boolean | undefined {
  try {
    return SettingsManager.create(cwd).getCompactionSettings().enabled;
  } catch {
    return undefined;
  }
}

function totals(entries: Iterable<any>): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const entry of entries) {
    const usage = entry?.type === "message" ? entry.message?.usage : entry?.usage;
    if (!usage) continue;
    input += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    output += usage.output ?? 0;
  }
  return { input, output };
}

export type ModelSpend = { model: string; requests: number; input: number; cache: number; output: number };

export type Summary = {
  id: string | undefined;
  resume: string | undefined;
  tools: number;
  failed: number;
  models: ModelSpend[];
  sittingMs: number;
  historyMs: number | undefined;
};

// When this launch began and when it ended. The first bounds the sitting the
// operator just had; a session record older than it is one they reopened.
export type Sitting = { launchedAt: number; endedAt: number };

// Where the session's records are kept. An identifier resolves against the
// harness's default session directory and nowhere else, so a session held
// elsewhere is named by its file; an undefined directory is one the harness
// would not answer for, and takes the file too.
export type SessionLocation = { file: string | undefined; isDefaultDir: boolean | undefined };

// A compaction is a model call whose entry names no model, so usage that names
// none is charged to the model in force when it was spent.
function spendByModel(entries: Iterable<any>): ModelSpend[] {
  const rows = new Map<string, ModelSpend>();
  let inForce = "unknown";
  for (const entry of entries) {
    const message = entry?.type === "message" ? entry.message : undefined;
    if (entry?.type === "model_change" && entry.modelId) inForce = String(entry.modelId);
    if (message?.role === "assistant" && message.model) inForce = String(message.model);
    const usage = message ? message.usage : entry?.usage;
    const answered = message?.role === "assistant";
    if (!usage && !answered) continue;
    const row = rows.get(inForce) ?? { model: inForce, requests: 0, input: 0, cache: 0, output: 0 };
    rows.set(inForce, row);
    if (answered) row.requests += 1;
    row.input += usage?.input ?? 0;
    row.cache += (usage?.cacheRead ?? 0) + (usage?.cacheWrite ?? 0);
    row.output += usage?.output ?? 0;
  }
  return [...rows.values()];
}

// Every figure here is a count of what this session did. None is divided by
// another, because a share below this project's stated minimum sample is
// withheld and one session is never that sample.
export function summarize(header: any, entries: any[], sitting: Sitting, where: SessionLocation): Summary | null {
  const messages = entries.filter((e) => e?.type === "message");
  if (!messages.some((e) => e.message?.role === "assistant")) return null;
  const results = messages.filter((e) => e.message?.role === "toolResult");
  const stamps = [header?.timestamp, ...entries.map((e) => e?.timestamp)]
    .map((t) => Date.parse(String(t)))
    .filter((n) => Number.isFinite(n));
  const opened = Date.parse(String(header?.timestamp));
  const resumed = opened < sitting.launchedAt;
  const started = Number.isFinite(opened) && !resumed ? opened : sitting.launchedAt;
  const id = typeof header?.id === "string" ? header.id : undefined;
  return {
    id,
    resume: where.isDefaultDir === true ? id : (where.file ?? id),
    tools: results.length,
    failed: results.filter((e) => e.message.isError === true).length,
    models: spendByModel(entries),
    sittingMs: sitting.endedAt - started,
    historyMs: resumed ? Math.max(...stamps) - Math.min(...stamps) : undefined,
  };
}

const COLUMNS = ["Model", "Reqs", "Input", "Cache", "Output"];
const GUTTER = "   ";
const NO_TERMINAL = 80;
const NARROWEST = 20;

const elide = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, Math.ceil((max - 1) / 2))}…${s.slice(s.length - Math.floor((max - 1) / 2))}`;

type SpendTable = { head: string; rows: string[]; label: number; span: number };

function spendTable(models: ModelSpend[], total: number, floor: number): SpendTable {
  const cells = (m: ModelSpend) =>
    [m.model, String(m.requests), formatTokens(m.input), formatTokens(m.cache), formatTokens(m.output)];
  const rows = models.map(cells);
  if (rows.length > 1) {
    const sum = (of: (m: ModelSpend) => number) => models.reduce((n, m) => n + of(m), 0);
    rows.push(cells({
      model: "total",
      requests: sum((m) => m.requests),
      input: sum((m) => m.input),
      cache: sum((m) => m.cache),
      output: sum((m) => m.output),
    }));
  }
  const width = COLUMNS.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const room = Math.max(
    COLUMNS[0].length,
    floor,
    total - GUTTER.length * (COLUMNS.length - 1) - width.slice(1).reduce((n, w) => n + w, 0),
  );
  if (width[0] > room) {
    for (const r of rows) r[0] = elide(r[0], room);
    width[0] = Math.max(COLUMNS[0].length, ...rows.map((r) => r[0].length));
  }
  width[0] = Math.max(width[0], floor);
  const row = (r: string[]) =>
    r.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i]))).join(GUTTER).trimEnd();
  return {
    head: row(COLUMNS),
    rows: rows.map(row),
    label: width[0],
    span: width.reduce((n, w) => n + w, 0) + GUTTER.length * (COLUMNS.length - 1),
  };
}

// The resume line is a command the operator pastes, so a path a shell would read
// as more than one word is quoted, as the harness quotes its own.
const shellWord = (s: string) =>
  /^[A-Za-z0-9_\-./~:@]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;

// Nothing here is shortened or cut, so a command too wide for the block is
// broken with the shell's own continuation and each piece quoted on its own,
// which a paste rejoins into the one word that was printed.
function resumeCommand(value: string, width: number): string[] {
  const lines: string[] = [];
  let head = "lm --resume ";
  let rest = value;
  while (head.length + shellWord(rest).length > width) {
    let take = rest.length;
    while (take > 1 && head.length + shellWord(rest.slice(0, take)).length + 1 > width) take -= 1;
    lines.push(`${head}${shellWord(rest.slice(0, take))}\\`);
    rest = rest.slice(take);
    head = "";
  }
  return [...lines, head + shellWord(rest)];
}

// The block is drawn after the harness has stopped the TUI, so it carries its
// own ink rather than the theme a render callback is handed.
export type Ink = {
  bold: (text: string) => string;
  accent: (text: string) => string;
  border: (text: string) => string;
};

const PLAIN: Ink = { bold: (t) => t, accent: (t) => t, border: (t) => t };

const PADDING = "  ";
const FRAME = 2 + PADDING.length * 2;

// The value column is one column across both sections, so the model names begin
// where the figures beside `Session` do. It gives way when the room it would
// take is room the identifier needs: a name elided to fit the table can be wider
// than every label in the section above it.
function sections(s: Summary, ink: Ink, width: number): string[] {
  const head: string[][] = [
    ...(s.id ? [["Session", s.id]] : []),
    ["Tools", `${s.tools} ran, ${s.failed} failed`],
    ["Time", formatDuration(s.sittingMs)],
    ...(s.historyMs === undefined ? [] : [["History", formatDuration(s.historyMs)]]),
  ];
  const name = Math.max(...head.map(([n]) => n.length));
  const value = Math.max(...head.map(([, v]) => v.length));
  const table = spendTable(s.models, width, name);
  const label = Math.max(name, Math.min(table.label, width - GUTTER.length - value));
  return [
    ink.bold("Summary"),
    ...head.map(([n, v]) => `${n.padEnd(label)}${GUTTER}${v}`),
    "",
    ink.bold("Spend"),
    table.head,
    ink.border("─".repeat(table.span)),
    ...table.rows,
    ...(s.resume ? ["", ink.bold("Resume"), ...resumeCommand(s.resume, width).map(ink.accent)] : []),
  ];
}

function framed(rows: string[], inner: number, ink: Ink): string[] {
  const rule = "─".repeat(inner + PADDING.length * 2);
  const side = ink.border("│");
  const pad = (r: string) => `${side}${PADDING}${r}${" ".repeat(Math.max(0, inner - visibleWidth(r)))}${PADDING}${side}`;
  return [ink.border(`┌${rule}┐`), ...["", ...rows, ""].map(pad), ink.border(`└${rule}┘`)];
}

export function summaryBlock(s: Summary, ink: Ink = PLAIN, screenWidth?: number): string[] {
  const width = Math.max(NARROWEST, screenWidth || NO_TERMINAL);
  const inner = width - FRAME;
  if (inner < NARROWEST) return sections(s, ink, width);
  const rows = sections(s, ink, inner);
  return rows.every((r) => visibleWidth(r) <= inner) ? framed(rows, inner, ink) : sections(s, ink, width);
}

// The harness writes a resume line of its own once every shutdown handler has
// returned, and offers no way to stop it: nothing fires after that event, and
// neither the line nor the path that writes it is exported. So the write is
// wrapped for exactly one chunk. This project's own block is written through
// the wrap, which is what holds the match to the harness's line alone.
const HARNESS_RESUME = /^To resume this session:/;

export function dropHarnessResume(out: { write: (chunk: any, ...rest: any[]) => boolean }): void {
  const original = out.write;
  out.write = function (chunk: any, ...rest: any[]): boolean {
    if (typeof chunk === "string" && HARNESS_RESUME.test(chunk.replace(ANSI, ""))) {
      out.write = original;
      return true;
    }
    return original.call(this, chunk, ...rest);
  };
}

// The harness repaints the title after every handler that could set one —
// measured at one paint on the way in and two on a session switch, the last of
// them after the rebind has re-emitted `session_start` — so a title set from an
// event holds until the next repaint and no longer. Its repaints carry the name
// instead: the leading word is replaced and the session name and directory it
// composed beside it are left alone. The wrap is marked because the event fires
// for every session and again for a reload, while the stream is the process's
// own and is wrapped once.
const TITLE = /^\x1b\]0;([^\x07]*)\x07$/;
const OWNED = "lmTitle";

export function ownTitle(out: { write: (chunk: any, ...rest: any[]) => boolean }): void {
  const original = out.write;
  if ((original as any)[OWNED]) return;
  const write = function (this: unknown, chunk: any, ...rest: any[]): boolean {
    const painted = typeof chunk === "string" ? TITLE.exec(chunk) : null;
    if (!painted) return original.call(this, chunk, ...rest);
    const parts = painted[1].split(" - ");
    parts[0] = "lm";
    return original.call(this, `\x1b]0;${parts.join(" - ")}\x07`, ...rest);
  };
  (write as any)[OWNED] = true;
  out.write = write;
}

const DOUBLE_ESCAPE_MS = 500;

// A press is not always a chunk of its own — tmux writes a double tap as one —
// and every other escape sequence opens with the same byte, so the presses in a
// chunk are counted and a chunk carrying anything after them is not a press.
const ESCAPES = /^\x1b+$/;

export class DoubleEscapeEditor extends CustomEditor {
  private lastEscape = 0;

  // Declaring `onEscape` here would sever the abort: the harness assigns one
  // that forwards to whichever handler its interrupt chain holds at the time,
  // and only while the subclass has left the property undefined.
  handleInput(data: string): void {
    const presses = ESCAPES.test(data) ? data.length : 0;
    if (presses > 0 && this.getText().length > 0 && !this.isShowingAutocomplete()) {
      const now = Date.now();
      if (presses > 1 || now - this.lastEscape < DOUBLE_ESCAPE_MS) {
        this.setText("");
        this.lastEscape = 0;
        return;
      }
      this.lastEscape = now;
    }
    super.handleInput(data);
  }
}

// Everything this project draws on the chat's screen. Without a terminal there
// is nothing to draw on.
export function installChrome(pi: any, updated?: string): void {
  // The closing block is written after the harness has stopped the TUI, where
  // the theme a header or footer callback is handed is out of scope. The header
  // callback keeps what the block draws with for then. A launch that draws
  // nothing never sets one, and the block goes out in plain text.
  let ink: Ink | undefined;

  // The same event fires for a reload and for each of the three ways a session
  // is replaced, where the chat carries on and a closing block would be a lie.
  // Only quitting ends the session, and the harness has already stopped the TUI
  // by then, so it goes to the restored terminal rather than to a frame.
  pi.on("session_shutdown", (event: any, ctx: any) => {
    if (event?.reason !== "quit" || !ctx.hasUI) return;
    dropHarnessResume(process.stdout);
    // The launch is the process's own start rather than the first session_start,
    // which fires again for a reload and rebuilds this extension while the same
    // sitting carries on.
    const manager = ctx.sessionManager;
    // The harness ships `usesDefaultSessionDir` and leaves it out of the type it
    // hands an extension, so a build that keeps its word answers nothing here.
    const isDefaultDir =
      typeof manager.usesDefaultSessionDir === "function" ? manager.usesDefaultSessionDir() === true : undefined;
    const summary = summarize(
      manager.getHeader(),
      manager.getEntries(),
      { launchedAt: performance.timeOrigin, endedAt: Date.now() },
      { file: manager.getSessionFile(), isDefaultDir },
    );
    if (!summary) return;
    process.stdout.write(`\n${summaryBlock(summary, ink, process.stdout.columns).join("\n")}\n`);
  });

  // The two choices the operator makes and expects to still have next time. Each
  // arrives once, from the harness, and neither is saved by it. A level names no
  // model, so it is written under the model in force, which is already the new
  // one when a switch is what changed the level.
  pi.on("model_select", (event: any, ctx: any) => {
    rememberModel(SettingsManager.create(ctx.cwd), event?.model);
  });
  pi.on("thinking_level_select", (event: any, ctx: any) => {
    rememberThinkingLevel(SettingsManager.create(ctx.cwd), ctx.model, event?.level);
  });

  // The header is built before extensions initialise, and `setHeader` is a no-op
  // until it exists, so this waits for session_start rather than running in the
  // factory.
  pi.on("session_start", (event: any, ctx: any) => {
    if (!ctx.hasUI) return;
    ownTitle(process.stdout);
    // The session is already on the version this names, so it reports rather
    // than instructs, and it is a system message rather than a row of chrome:
    // the header is what the screen always says, and this happened once. `info`
    // is the level that prints it dim and bare, where the other two prefix it
    // with a word claiming something is wrong. Only the launch is announced,
    // because the same event fires again for a reload that installed nothing.
    if (updated && event?.reason === "startup") ctx.ui.notify(`harness updated to ${updated}`, "info");
    const autoCompact = compactionEnabled(ctx.cwd);
    ctx.ui.setHeader((_tui: unknown, theme: any) => {
      ink = {
        bold: (text: string) => theme.bold(theme.fg("text", text)),
        accent: (text: string) => theme.fg("accent", text),
        border: (text: string) => theme.fg("borderAccent", text),
      };
      return { render: () => headerLines(theme) };
    });
    ctx.ui.setFooter((_tui: unknown, theme: any, footerData: any) => ({
      render: (width: number) => {
        const usage = ctx.getContextUsage();
        const { input, output } = totals(ctx.sessionManager.getEntries());
        return footerLines(theme, width, {
          cwd: ctx.sessionManager.getCwd(),
          branch: footerData.getGitBranch(),
          model: ctx.model?.id ?? "no model",
          contextTokens: usage?.tokens ?? null,
          contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
          autoCompact,
          input,
          output,
          thinking: ctx.model?.reasoning ? ctx.thinkingLevel : undefined,
        });
      },
    }));
    ctx.ui.setEditorComponent((tui: any, editorTheme: any, keybindings: any) =>
      new DoubleEscapeEditor(tui, editorTheme, keybindings));
  });
}
