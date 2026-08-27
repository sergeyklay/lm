import { list, meta } from "./registry.mts";
import { runVerb, type Io } from "./verb.mts";

// What a verb looks like from inside the chat: the arguments a human types, and
// nothing about the verb's own answer. The chat's model chooses the verb and the
// text; the verb still writes its own prompt from the repository and asks the
// model itself, so what it commits is what `lm commit` commits.
const PARAMETERS = {
  type: "object",
  properties: {
    text: { type: "string", description: "optional free text for the verb, as typed on the command line" },
    dry_run: { type: "boolean", description: "render the answer and stop before the side effect" },
  },
} as const;

// 7 is the human saying no, and a chat has no exit status to carry it, so the
// tool result says it in words. Anything else non-zero is a failure the model
// should not paper over.
function outcome(code: number): string {
  if (code === 0) return "";
  if (code === 7) return "Declined. Nothing was applied.";
  return `The verb failed with exit ${code}.`;
}

export function registerVerbs(pi: any, toolsDir: string): string[] {
  const registered: string[] = [];
  // The index is the directory listing here as everywhere else, so a fifth tool
  // file is offered in the next session with no file edited.
  for (const file of list(toolsDir)) {
    const info = meta(file);
    registered.push(info.name);
    pi.registerTool({
      name: info.name,
      label: info.name,
      description: info.description,
      promptSnippet: info.description,
      parameters: PARAMETERS,
      execute: async (_id: string, params: any, _signal: unknown, _onUpdate: unknown, ctx: any) => {
        const argv: string[] = [];
        if (params?.dry_run) argv.push("--dry-run");
        if (params?.text) argv.push("--", String(params.text));

        let said = "";
        const io: Io = {
          out: (s) => (said += s),
          err: (s) => (said += s),
          ask: {
            // The question is the tool file's own. What the runner adds is the
            // artefact beside it, because the human is being asked about
            // something the chat has not shown them yet.
            confirm: (question) =>
              ctx.hasUI
                ? ctx.ui.confirm(info.name, `${said.trim()}\n\n${question}`.trim())
                : Promise.resolve(false),
            // undefined is no answer, which the bridge turns into a refusal.
            // Without a dialog to show there is no answer to be had.
            input: (question) =>
              ctx.hasUI ? ctx.ui.input(info.name, question) : Promise.resolve(undefined),
          },
        };

        const result = await runVerb(file, argv, {}, io);
        const text = [said.trim(), outcome(result.code)].filter((p) => p.length > 0).join("\n\n");
        return {
          content: [{ type: "text", text: text || `The verb produced nothing and exited ${result.code}.` }],
          details: undefined,
        };
      },
    });
  }
  return registered;
}
