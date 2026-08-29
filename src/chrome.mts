import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

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
  tools: number;
  failed: number;
  models: ModelSpend[];
  ms: number;
};

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
export function summarize(header: any, entries: any[]): Summary | null {
  const messages = entries.filter((e) => e?.type === "message");
  if (!messages.some((e) => e.message?.role === "assistant")) return null;
  const results = messages.filter((e) => e.message?.role === "toolResult");
  const stamps = [header?.timestamp, ...entries.map((e) => e?.timestamp)]
    .map((t) => Date.parse(String(t)))
    .filter((n) => Number.isFinite(n));
  return {
    id: typeof header?.id === "string" ? header.id : undefined,
    tools: results.length,
    failed: results.filter((e) => e.message.isError === true).length,
    models: spendByModel(entries),
    ms: stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : 0,
  };
}

const COLUMNS = ["Model", "Reqs", "Input", "Cache", "Output"];
const GUTTER = "   ";

function spendTable(models: ModelSpend[]): string[] {
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
  const row = (r: string[]) =>
    r.map((c, i) => (i === 0 ? c.padEnd(width[i]) : c.padStart(width[i]))).join(GUTTER).trimEnd();
  return [row(COLUMNS), ...rows.map(row)];
}

export function summaryBlock(s: Summary): string[] {
  const head: string[][] = [
    ...(s.id ? [["Session", s.id]] : []),
    ["Tools", `${s.tools} ran, ${s.failed} failed`],
    ["Time", formatDuration(s.ms)],
  ];
  const label = Math.max(...head.map(([name]) => name.length));
  return [
    ...head.map(([name, value]) => `${name.padEnd(label)}${GUTTER}${value}`),
    "",
    ...spendTable(s.models),
    ...(s.id ? ["", `Resume: lm --session ${s.id}`] : []),
  ];
}

// Everything this project draws on the chat's screen. Without a terminal there
// is nothing to draw on.
export function installChrome(pi: any): void {
  // The same event fires for a reload and for each of the three ways a session
  // is replaced, where the chat carries on and a closing block would be a lie.
  // Only quitting ends the session, and the harness has already stopped the TUI
  // by then, so it goes to the restored terminal rather than to a frame.
  pi.on("session_shutdown", (event: any, ctx: any) => {
    if (event?.reason !== "quit" || !ctx.hasUI) return;
    const summary = summarize(ctx.sessionManager.getHeader(), ctx.sessionManager.getEntries());
    if (summary) process.stdout.write(`\n${summaryBlock(summary).join("\n")}\n`);
  });

  // The header is built before extensions initialise, and `setHeader` is a no-op
  // until it exists, so this waits for session_start rather than running in the
  // factory.
  pi.on("session_start", (_event: unknown, ctx: any) => {
    if (!ctx.hasUI) return;
    const autoCompact = compactionEnabled(ctx.cwd);
    ctx.ui.setHeader((_tui: unknown, theme: any) => ({ render: () => headerLines(theme) }));
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
  });
}
