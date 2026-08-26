import { createAgentSession, SessionManager, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { call, meta } from "./registry.mts";
import { resolveModel } from "./model.mts";

const MAX_CALLS = 2;

const bareLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "Answer by calling the single available tool. Do not reply in prose.",
  getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [],
  getAppendSystemPromptSources: () => [],
  extendResources: () => {},
  reload: async () => {},
};

export type Outcome = { code: number; calls: number; attempts: number };

export async function runVerb(file: string, args: string[], env: Record<string, string>): Promise<Outcome> {
  const cwd = process.cwd();
  const opts = { cwd, env };
  const name = meta(file).name;

  const collected = call(file, "collect", { ...opts, args });
  process.stderr.write(collected.stderr);
  if (collected.status !== 0) return { code: collected.status, calls: 0, attempts: 0 };
  const prompt = collected.stdout;

  for (const a of args) {
    if (a.startsWith("-")) continue;
    if (!prompt.includes(a)) process.stderr.write(`lm: '${name}' made no use of the text you gave it\n`);
    break;
  }

  const schema = call(file, "schema", opts);
  if (schema.status !== 0) {
    process.stderr.write(schema.stderr);
    return { code: schema.status, calls: 0, attempts: 0 };
  }

  const { model } = await resolveModel(
    process.env.LM_OLLAMA ?? "http://127.0.0.1:11434",
    process.env.LM_MODEL ?? "qwen3.8:27b",
    Number(process.env.LM_CTX ?? 32768),
  );

  let calls = 0;
  let attempts = 0;
  let violations = "";
  let rendered = "";

  const { session } = await createAgentSession({
    cwd,
    model,
    sessionManager: SessionManager.inMemory(),
    resourceLoader: bareLoader as any,
    noTools: "all",
    tools: [name],
    customTools: [
      {
        name,
        label: name,
        description: meta(file).description,
        parameters: JSON.parse(schema.stdout),
        execute: async (_id: string, params: unknown) => {
          attempts += 1;
          const answer = JSON.stringify(params);
          const v = call(file, "validate", { ...opts, stdin: answer });
          violations = v.stdout.trim();
          if (violations) return { output: `VIOLATION:\n${violations}`, terminate: true };
          rendered = call(file, "render", { ...opts, stdin: answer }).stdout;
          return { output: "accepted", terminate: true };
        },
      } as any,
    ],
  });

  session.subscribe((e: any) => {
    if (e.type === "turn_start") calls += 1;
    if (e.type === "turn_end" && violations && attempts < MAX_CALLS) {
      session.agent.followUp({
        role: "user",
        content: [{ type: "text", text: `The previous attempt was rejected for these reasons. Fix them and call ${name} again:\n${violations}` }],
        timestamp: Date.now(),
      } as any);
    }
  });

  await session.prompt(prompt);

  if (attempts === 0) {
    process.stderr.write("lm: model returned no answer (a failure, not an empty answer)\n");
    return { code: 5, calls, attempts };
  }
  if (violations) {
    process.stderr.write("lm: validator rejected two attempts:\n");
    process.stderr.write(violations.replace(/^/gm, "  - ") + "\n");
    return { code: 4, calls, attempts };
  }
  process.stdout.write(rendered);
  return { code: 0, calls, attempts };
}
