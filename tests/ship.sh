#!/usr/bin/env bash
# The `lm ship` workflow, driven the way the operator drives it: `bin/lm` into
# runWorkflow over tools/ship.sh, with commit and pr stubbed as tool files of
# their own. Everything the workflow owns is testable without a GPU because
# none of it is the model's: which branch the commit lands on, what that branch
# ends up named, what a refusal leaves behind, and what a rehearsal may touch,
# which is nothing.
#
# The stubs make a real model call and a recording server answers it, so the run
# goes through every line the operator's does. What each verb was handed comes
# back off that recording rather than out of a log the stub writes, because
# collect() is read-only and a stub that broke the rule would teach it wrong.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
fail=0

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

SRV=$(mktemp -d)
SRVLOG=$SRV/requests
PORTFILE=$SRV/port

cat > "$SRV/model.mjs" <<'EOF'
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

// One tool call, streamed the way the harness reads it. The name is echoed back
// out of the request, so the one server answers whichever verb is asking.
const sse = (name, args) => {
  const base = { id: "1", object: "chat.completion.chunk", created: 0, model: "m" };
  const mk = (d, fr = null) =>
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason: fr }] })}\n\n`;
  return mk({ role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: "" } }] })
    + mk({ tool_calls: [{ index: 0, function: { arguments: args } }] })
    + mk({}, "tool_calls") + "data: [DONE]\n\n";
};

const [portFile, log] = process.argv.slice(2);
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* not a request this suite reads */ }
    const name = body.tools?.[0]?.function?.name ?? "none";
    appendFileSync(log, JSON.stringify(body.messages ?? []) + "\n");
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse(name, JSON.stringify({ a: `rendered by ${name}` })));
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
EOF

node "$SRV/model.mjs" "$PORTFILE" "$SRVLOG" &
MODEL=$!
trap 'kill "$MODEL" 2>/dev/null; rm -rf "$SRV"' EXIT
for _ in $(seq 1 100); do [ -s "$PORTFILE" ] && break; sleep 0.05; done
[ -s "$PORTFILE" ] || { echo "FAIL the recording model never listened"; exit 1; }

PORT=$(cat "$PORTFILE")
export LM_OLLAMA="http://127.0.0.1:$PORT"
# One log spans every repository, so a fixture run has to opt out of it.
export LM_LOG=

# $1 becomes the stubbed commit's exit status, standing in for what `confirm`
# returns: 0 is a yes, 7 the refusal a human makes.
setup() {
  # The registry sits outside the fixture repository, so the tree the workflow
  # stages is the operator's work and nothing this suite put there.
  work=$(mktemp -d); tools=$(mktemp -d)
  cp "$ROOT/tools/ship.sh" "$tools/ship.sh"
  cat > "$tools/commit.sh" <<'EOF'
name="commit"
description="stub"
collect() {
  git diff --cached --quiet && { echo "lm: nothing staged" >&2; return 3; }
  printf 'stub=commit flow=%s yes=%s args=[%s]\n' "${LM_WORKFLOW:-none}" "${LM_YES:-unset}" "$*"
}
schema() { printf '%s\n' '{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}'; }
validate() { cat >/dev/null; }
render() { jq -r .a; }
apply() {
  cat >/dev/null
  [ "${LM_STUB_RC:-0}" = 0 ] || exit "${LM_STUB_RC}"
  git commit -qm "feat: scope the widget to one repository"
}
EOF
  cat > "$tools/pr.sh" <<'EOF'
name="pr"
description="stub"
collect() { printf 'stub=pr flow=%s yes=%s args=[%s]\n' "${LM_WORKFLOW:-none}" "${LM_YES:-unset}" "$*"; }
schema() { printf '%s\n' '{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}'; }
validate() { cat >/dev/null; }
render() { jq -r .a; }
apply() { cat >/dev/null; echo "PR opened"; }
EOF
  export LM_TOOLS=$tools LM_STUB_RC=${1:-0}
  : > "$SRVLOG"
  cd "$work" || exit 1
  git init -q -b main .; git config user.email t@t; git config user.name t
  echo seed > f.txt; git add .; git commit -qm "chore: seed"
  echo change > f.txt; git add f.txt
}

ship() { node "$ROOT/bin/lm" ship "$@"; }

teardown() { cd /; rm -rf "$work" "$tools"; }

# A thematic branch is what happens when nothing is said, named from the subject.
setup 0
out=$(ship 2>&1)
check "branch is named from the subject" "feat/scope-the-widget" "$(git branch --show-current)"
check "the commit landed on it"          "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
check "pr ran"                           "PR opened" "$(grep -m1 'PR opened' <<<"$out")"
check "main is untouched"                "chore: seed" "$(git log -1 --format='%s' main)"
teardown

# --here commits where the operator already is.
setup 0
ship --here >/dev/null 2>&1
check "--here stays on the branch"    "main" "$(git branch --show-current)"
check "--here still commits"          "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
check "--here leaves no other branch" "main" "$(git branch --format='%(refname:short)' | paste -sd,)"
teardown

# A refusal leaves neither a branch nor a commit.
setup 7
ship >/dev/null 2>&1; rc=$?
check "the refusal is passed through" "7"    "$rc"
check "back on the original branch"   "main" "$(git branch --show-current)"
check "no branch left behind"         "main" "$(git branch --format='%(refname:short)' | paste -sd,)"
check "no commit made"                "chore: seed" "$(git log -1 --format='%s')"
check "the work is still staged"      "f.txt" "$(git diff --cached --name-only | paste -sd,)"
teardown

# The same refusal with --here, where there is no placeholder to clean up.
setup 7
ship --here >/dev/null 2>&1; rc=$?
check "--here passes the refusal through" "7"    "$rc"
check "--here made no commit"             "chore: seed" "$(git log -1 --format='%s')"
teardown

# An unstaged tree ships without a git add. g.txt is untracked on purpose: git diff
# never reports one and git add takes it, which is the difference the workflow
# rests on. Silence is the assertion too: staging is the expected case now.
setup 0
git reset -q
echo more > g.txt
out=$(ship 2>&1)
check "the unstaged change was shipped" "f.txt,g.txt" "$(git show --name-only --format= HEAD | paste -sd,)"
check "and staging said nothing"        "0" "$(grep -c 'nothing to stage' <<<"$out")"
teardown

# --no-stage gets today's behaviour back: nothing is staged, and the verb refuses
# an empty index the way it refuses one the operator left empty themselves.
setup 0
git reset -q
ship --no-stage >/dev/null 2>&1; rc=$?
check "--no-stage passes the refusal through" "3" "$rc"
check "--no-stage staged nothing"             " M f.txt" "$(git status --porcelain)"
teardown

# Nothing to stage is the surprising case, so that is the one that speaks.
setup 0
git reset -q --hard
out=$(ship 2>&1)
check "a clean tree is named" "1" "$(grep -c 'nothing to stage' <<<"$out")"
teardown

# Both verbs of one workflow carry the same name, and it is not empty. The log
# cannot tell a run from a workflow apart from a typed one without it: lm writes one
# record per verb, so one delivery leaves two that look like two the operator typed.
setup 0
ship >/dev/null 2>&1
check "both verbs saw a workflow" "2" "$(grep -c 'flow=ship-' "$SRVLOG")"
check "and it was the same one"   "1" "$(grep -o 'flow=ship-[0-9]*' "$SRVLOG" | sort -u | wc -l)"
teardown

# Consent belongs to the workflow. A verb takes it as a flag, and both verbs here
# are run by the workflow rather than typed, so the flag is consumed once and the
# variable is what reaches them.
setup 0
ship --yes >/dev/null 2>&1
check "--yes reaches both verbs as the variable" "2" "$(grep -c 'yes=1' "$SRVLOG")"
check "and the commit still lands"               "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
teardown

setup 0
ship >/dev/null 2>&1
check "without it the verbs are asked as before" "2" "$(grep -c 'yes=unset' "$SRVLOG")"
teardown

# Free text is the one thing a workflow forwards, because it is what the
# operator meant the delivery to be and both verbs write from it.
setup 0
ship widen the scope >/dev/null 2>&1
check "the text reaches both verbs" "2" "$(grep -c 'args=\[widen the scope\]' "$SRVLOG")"
teardown

# --dry-run is the whole workflow's rehearsal and not only its verbs'. ship's
# side effects are its hooks, so a rehearsal runs none of them and the repository
# reads back exactly as it did.
setup 0
# Both halves of a dirty tree, because the run stages both and the rehearsal must
# be seen not to: f.txt is staged and modified again on top, g.txt is untracked.
echo again >> f.txt
echo more > g.txt
was_status=$(git status --porcelain)
was_log=$(git log --oneline)
was_reflog=$(git reflog)
out=$(ship --dry-run 2>&1); rc=$?
check "--dry-run exits 0"                      "0"             "$rc"
check "--dry-run leaves the tree as it was"    "$was_status"   "$(git status --porcelain)"
check "--dry-run makes no commit"              "$was_log"      "$(git log --oneline)"
check "--dry-run stays on the branch"          "main"          "$(git branch --show-current)"
check "--dry-run cuts no branch"               "main"          "$(git branch --format='%(refname:short)' | paste -sd,)"
check "--dry-run writes no reflog entry"       "$was_reflog"   "$(git reflog)"
check "and still shows what commit would do"   "1" "$(grep -c 'rendered by commit' <<<"$out")"
check "and what pr would do"                   "1" "$(grep -c 'rendered by pr' <<<"$out")"
check "and says its own steps did not run"     "1" "$(grep -c "ship's own steps do not run" <<<"$out")"
teardown

# The rehearsal is thinner than the run, and honestly so: staging is a side effect
# and the tree is the operator's, so the verb refuses on its own account rather
# than on a tree the rehearsal staged for it.
setup 0
git reset -q
ship --dry-run >/dev/null 2>&1; rc=$?
check "a rehearsal stages nothing"         ""  "$(git diff --cached --name-only)"
check "and the verb refuses on its own account" "3" "$rc"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
