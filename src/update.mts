import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PACKAGE = "@earendil-works/pi-coding-agent";
const ABBREVIATED = "application/vnd.npm.install-v1+json";

// npm's own configuration, so the versions offered come from the registry npm
// would install from rather than from one named here.
const packument = () =>
  `${(process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/+$/, "")}/${PACKAGE.replace("/", "%2f")}`;

// The launch waits on this one request. The install it may lead to is not bounded.
export const REGISTRY_DEADLINE_MS = 2000;

const CLONE = new URL("../", import.meta.url);

// The harness's own semver rather than a dependency of this project's: it is the
// package whose range is being satisfied and it already carries one.
const semver = () => createRequire(import.meta.resolve(PACKAGE))("semver");

function declaredRange(clone: URL): string | undefined {
  const pkg = JSON.parse(readFileSync(new URL("package.json", clone), "utf8"));
  const range = pkg?.dependencies?.[PACKAGE];
  return typeof range === "string" ? range : undefined;
}

function installedVersion(clone: URL): string | undefined {
  const pkg = JSON.parse(readFileSync(new URL(`node_modules/${PACKAGE}/package.json`, clone), "utf8"));
  return typeof pkg?.version === "string" ? pkg.version : undefined;
}

// The newest release the declared range admits, or nothing when that is already
// installed. The range is the whole of the policy.
export function pickTarget(available: readonly string[], range: string, installed: string): string | undefined {
  const newest = semver().maxSatisfying([...available], range);
  return newest && newest !== installed ? newest : undefined;
}

async function published(signal: AbortSignal): Promise<readonly string[]> {
  const res = await fetch(packument(), { headers: { accept: ABBREVIATED }, signal });
  if (!res.ok) throw new Error(`the registry answered ${res.status}`);
  const body: any = await res.json();
  return Object.keys(body?.versions ?? {});
}

// `--no-save` is what keeps the operator's working tree clean. The same command
// without it rewrites the range in `package.json` and the lock beside it.
function install(version: string, clone: URL): boolean {
  const npm = spawnSync("npm", ["install", "--no-save", `${PACKAGE}@${version}`], {
    cwd: fileURLToPath(clone),
    stdio: "ignore",
  });
  return npm.status === 0;
}

export type Update = {
  clone?: URL;
  allowNetwork?: boolean;
  published?: (signal: AbortSignal) => Promise<readonly string[]>;
  install?: (version: string) => boolean;
};

// The version the chat moved to, or undefined when it stayed where it was. Every
// way this can fail returns undefined and prints nothing: an update that did not
// happen is not news, and the chat opens on the version already installed.
export async function updateHarness(context: Update = {}): Promise<string | undefined> {
  if (context.allowNetwork === false) return undefined;
  const clone = context.clone ?? CLONE;
  try {
    const range = declaredRange(clone);
    const installed = installedVersion(clone);
    if (!range || !installed) return undefined;
    const versions = await (context.published ?? published)(AbortSignal.timeout(REGISTRY_DEADLINE_MS));
    const target = pickTarget(versions, range, installed);
    if (target === undefined) return undefined;
    return (context.install ?? ((v: string) => install(v, clone)))(target) ? target : undefined;
  } catch {
    return undefined;
  }
}
