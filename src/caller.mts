// Which caller a run came from, as a closed set this file owns. The command line
// is the base case and names itself nowhere; every other caller declares itself in
// LM_CALLER, so a scheduler or an editor plugin costs a member here and no edit to
// either runner. A name outside the set is not a caller, and reads as the base case.
export const CALLER = { cli: "cli", chat: "chat" } as const;

export type Caller = (typeof CALLER)[keyof typeof CALLER];

const NAMES: readonly string[] = Object.values(CALLER);

export function callerOf(env: Record<string, string | undefined> = process.env): Caller {
  const named = env.LM_CALLER ?? "";
  return NAMES.includes(named) ? (named as Caller) : CALLER.cli;
}
