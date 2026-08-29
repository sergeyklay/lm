import { CALLER } from "./caller.mts";
import { meta } from "./registry.mts";
import { runVerb, type Io } from "./verb.mts";
import { runWorkflow, type IoFor } from "./workflow.mts";

// What a verb looks like from inside the chat: the arguments a human types, and
// nothing about the verb's own answer. The chat's model chooses the verb and the
// text; the verb still writes its own prompt from the repository and asks the
// model itself, so what it commits is what `lm commit` commits. A workflow
// offers the same two, because `--here` and `--no-stage` decide where a commit
// lands and neither is in «ship these changes».
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

export function registerVerbs(pi: any, files: string[]): string[] {
  const registered: string[] = [];
  // The index is the directory listing here as everywhere else, so a fifth tool
  // file is offered in the next session with no file edited. What a file is is
  // declared in the file: one that names verbs is a workflow the runner
  // drives, one that does not is a verb it runs.
  let runs = 0;
  for (const file of files) {
    const info = meta(file);
    const isWorkflow = info.verbs.length > 0;
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
        // Built per label rather than once, because the two dialogs a delivery
        // shows are its verbs' own and each says which verb is asking.
        const io: IoFor = (label) => ({
          out: (s) => (said += s),
          err: (s) => (said += s),
          ask: {
            // The question is the tool file's own. What the runner adds is the
            // artefact beside it, because the human is being asked about
            // something the chat has not shown them yet.
            confirm: (question) =>
              ctx.hasUI
                ? ctx.ui.confirm(label, `${said.trim()}\n\n${question}`.trim())
                : Promise.resolve(false),
            // undefined is no answer, which the bridge turns into a refusal.
            // Without a dialog to show there is no answer to be had.
            input: (question) =>
              ctx.hasUI ? ctx.ui.input(label, question) : Promise.resolve(undefined),
          },
        });

        // The chat declares itself rather than letting the runner infer it from the
        // tag, which is per run and not per process: one chat session is one pid, so
        // `$$` would tag every delivery of a session identically and `lm stats`
        // would read them as one.
        const env = { LM_CALLER: CALLER.chat };
        const result = isWorkflow
          ? await runWorkflow(file, files, argv, `${info.name}-${process.pid}-${++runs}`, io, env)
          : await runVerb(file, argv, env, io(info.name));

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
