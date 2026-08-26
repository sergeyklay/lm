import type { ToolMeta } from "./registry.mts";

export type Parsed =
  | { ok: true; dry: boolean; args: string[]; env: Record<string, string> }
  | { ok: false; message: string };

export function usage(tools: ToolMeta[]): string {
  const w = Math.max(0, ...tools.map((t) => t.name.length));
  const rows = tools.map((t) => `  ${t.name.padEnd(w + 4)}${t.description}`);
  return [
    "usage: lm <verb> [--dry-run] [text] | lm --list | lm --which <text>",
    "",
    "Commands:",
    "",
    ...rows,
    "",
    "",
  ].join("\n");
}

export function noSuchTool(verb: string, tools: ToolMeta[]): string {
  return [`lm: no such tool '${verb}'. Available:`, ...tools.map((t) => `  ${t.name}`), ""].join("\n");
}

const envName = (flag: string) => "LM_" + flag.slice(2).replace(/-/g, "_").toUpperCase();

export function parse(argv: string[], verb: string, flags: string[]): Parsed {
  let dry = false;
  let literal = false;
  const args: string[] = [];
  const env: Record<string, string> = {};

  for (const a of argv) {
    if (literal) {
      args.push(a);
      continue;
    }
    if (a === "--dry-run") dry = true;
    else if (a === "--") literal = true;
    else if (a.startsWith("-")) {
      if (!flags.includes(a)) {
        return {
          ok: false,
          message:
            `lm: '${verb}' takes no flag '${a}'.\n` +
            `    Known: --dry-run${flags.length ? " " + flags.join(" ") : ""}.` +
            ` Put text after -- to pass it literally.\n`,
        };
      }
      env[envName(a)] = "1";
    } else args.push(a);
  }
  return { ok: true, dry, args, env };
}
