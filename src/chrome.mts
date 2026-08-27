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
  const tokens = c.input || c.output
    ? theme.fg("dim", `↑${formatTokens(c.input)} ↓${formatTokens(c.output)}`)
    : "";

  return [
    threeSlots(width, bold(shortenCwd(c.cwd, homedir())), c.branch ? bold(c.branch) : "", tokens),
    threeSlots(width, contextColoured, "", bold(c.model)),
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

// The header is built before extensions initialise, and `setHeader` is a no-op
// until it exists, so this waits for session_start rather than running in the
// factory. Without a terminal there is nothing to draw on.
export function installChrome(pi: any): void {
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
        });
      },
    }));
  });
}
