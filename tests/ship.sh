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
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

// One tool call, streamed the way the harness reads it. The name is echoed back
// out of the request, so the one server answers whichever verb is asking. A case
// that needs a shaped answer writes it to answers/<verb> first; the rest get the
// one-field answer the stub tools declare.
const sse = (name, args) => {
  const base = { id: "1", object: "chat.completion.chunk", created: 0, model: "m" };
  const mk = (d, fr = null) =>
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: d, finish_reason: fr }] })}\n\n`;
  return mk({ role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name, arguments: "" } }] })
    + mk({ tool_calls: [{ index: 0, function: { arguments: args } }] })
    + mk({}, "tool_calls") + "data: [DONE]\n\n";
};

const [portFile, log, answers] = process.argv.slice(2);
const argsFor = (name) => {
  try { return readFileSync(`${answers}/${name}`, "utf8").trim(); }
  catch { return JSON.stringify({ a: `rendered by ${name}` }); }
};
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* not a request this suite reads */ }
    const name = body.tools?.[0]?.function?.name ?? "none";
    appendFileSync(log, JSON.stringify(body.messages ?? []) + "\n");
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse(name, argsFor(name)));
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
EOF

ANSWERS=$SRV/answers; mkdir -p "$ANSWERS"
node "$SRV/model.mjs" "$PORTFILE" "$SRVLOG" "$ANSWERS" &
MODEL=$!
trap 'kill "$MODEL" 2>/dev/null; rm -rf "$SRV"' EXIT
for _ in $(seq 1 100); do [ -s "$PORTFILE" ] && break; sleep 0.05; done
[ -s "$PORTFILE" ] || { echo "FAIL the recording model never listened"; exit 1; }

PORT=$(cat "$PORTFILE")
export LM_OLLAMA="http://127.0.0.1:$PORT"
# One log spans every repository, so a fixture run has to opt out of it.
export LM_LOG=

stub_pr() {
  cat > "$tools/pr.sh" <<'EOF'
name="pr"
description="stub"
collect() { printf 'stub=pr flow=%s yes=%s args=[%s]\n' "${LM_WORKFLOW:-none}" "${LM_YES:-unset}" "$*"; }
schema() { printf '%s\n' '{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}'; }
validate() { cat >/dev/null; }
render() { jq -r .a; }
apply() { cat >/dev/null; echo "PR opened"; }
EOF
}

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
flags="--no-stage"
collect() {
  if [ -n "${LM_NO_STAGE:-}" ]; then
    git diff --cached --quiet && { echo "lm: nothing staged" >&2; return 3; }
  else
    git diff HEAD --quiet && [ -z "$(git ls-files --others --exclude-standard)" ] &&
      { echo "lm: nothing to commit" >&2; return 3; }
  fi
  printf 'stub=commit flow=%s yes=%s args=[%s]\n' "${LM_WORKFLOW:-none}" "${LM_YES:-unset}" "$*"
}
schema() { printf '%s\n' '{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]}'; }
validate() { cat >/dev/null; }
render() { jq -r .a; }
apply() {
  cat >/dev/null
  [ "${LM_STUB_RC:-0}" = 0 ] || exit "${LM_STUB_RC}"
  [ -n "${LM_NO_STAGE:-}" ] || git add -A
  git commit -qm "feat: scope the widget to one repository"
}
EOF
  stub_pr
  export LM_TOOLS=$tools LM_STUB_RC=${1:-0}
  : > "$SRVLOG"; rm -f "$ANSWERS"/*
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

# An unstaged tree ships without a git add of the operator's. g.txt is untracked
# on purpose: git diff never reports one and git add takes it, which is the
# difference the verb rests on. The workflow no longer stages, so what this reads
# is the staging that moved into apply().
setup 0
git reset -q
echo more > g.txt
ship >/dev/null 2>&1
check "the unstaged change was shipped" "f.txt,g.txt" "$(git show --name-only --format= HEAD | paste -sd,)"
teardown

# --no-stage means the verb takes only what is already staged, so what the
# operator left out of the index is still there afterwards.
setup 0
git reset -q
echo more > g.txt
git add f.txt
ship --no-stage >/dev/null 2>&1
check "--no-stage commits the index"      "f.txt" "$(git show --name-only --format= HEAD | paste -sd,)"
check "and leaves the rest of the tree"   "?? g.txt" "$(git status --porcelain)"
teardown

# Nothing to commit is the verb's own refusal, and no step of the workflow can
# manufacture something for it to work on any more.
setup 0
git reset -q --hard
ship >/dev/null 2>&1; rc=$?
check "a clean tree is refused"    "3" "$rc"
check "and no branch is left over" "main" "$(git branch --format='%(refname:short)' | paste -sd,)"
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

# The rehearsal is thinner than the run, and honestly so. Staging is a side effect
# inside apply() now, so this covers the verb as well as the workflow.
setup 0
git reset -q
ship --dry-run >/dev/null 2>&1; rc=$?
check "a rehearsal stages nothing" "" "$(git diff --cached --name-only)"
check "and a rehearsal exits 0"    "0" "$rc"
teardown

# A verb whose input an earlier step would have made refuses the way it would if
# you ran it yourself now. No step makes one any more, so the tree has to be clean
# for there to be nothing to work on.
setup 0
git reset -q --hard
ship --dry-run >/dev/null 2>&1; rc=$?
check "and the verb refuses on its own account" "3" "$rc"
teardown

# Everything below runs the real tools/commit.sh rather than the stub, because
# what is being read is what the verb does to a repository: how many commits it
# makes, which files each carries, and what it leaves when a hook stops it. pr
# stays a stub; none of this is about pr. --yes is what stands in for the person
# at the terminal, since confirm() reads a /dev/tty a suite has none of.
setup_real() { # $1 how many of a b c d the tree changes
  work=$(mktemp -d); tools=$(mktemp -d)
  cp "$ROOT/tools/ship.sh" "$tools/ship.sh"
  cp "$ROOT/tools/commit.sh" "$tools/commit.sh"
  stub_pr
  export LM_TOOLS=$tools
  : > "$SRVLOG"; rm -f "$ANSWERS"/*
  cd "$work" || exit 1
  git init -q -b main .; git config user.email t@t; git config user.name t
  local f k=0
  for f in a b c d; do echo seed > "$f.txt"; done
  git add .; git commit -qm "chore: seed"
  for f in a b c d; do k=$((k + 1)); [ "$k" -le "$1" ] && echo "changed $f" > "$f.txt"; done
  return 0
}

# One commit per argument, in the order given. The messages are the fixture's, so
# nothing here depends on what a model would have said.
groups() {
  local f
  for f in "$@"; do
    jq -nc --arg f "$f" --arg t "${f%%.*}" '{files:[$f],type:"chore",scope:"",
      subject:("touch " + $t),
      body:"One file changed here and the reason is that this fixture needed it to."}'
  done | jq -sc '{groups: .}'
}

# One group is the control the narrowing mutants need: with a single commit there
# is nothing to narrow the index to, so a run that commits the whole index looks
# exactly like a correct one here and only the cases below tell them apart.
setup_real 1
groups a.txt > "$ANSWERS/commit"
ship --yes >/dev/null 2>&1; rc=$?
check "one group exits 0"        "0" "$rc"
check "and lands one commit"     "chore: touch a,chore: seed" "$(git log --format='%s' -2 | paste -sd,)"
teardown

# Two unrelated changes, one model call, two commits, and neither carries the
# other file. This is the shape Q7 measured mixing at 4/50 on.
setup_real 2
groups a.txt b.txt > "$ANSWERS/commit"
ship --yes >/dev/null 2>&1; rc=$?
check "two unrelated changes exit 0"      "0" "$rc"
check "and land two commits"              "chore: touch b,chore: touch a,chore: seed" "$(git log --format='%s' -3 | paste -sd,)"
check "the second carries only its file"  "b.txt" "$(git show --name-only --format= HEAD | paste -sd,)"
check "and the first only its own"        "a.txt" "$(git show --name-only --format= HEAD~1 | paste -sd,)"
check "out of one model call"             "1" "$(grep -c 'Split these changes into commits' "$SRVLOG")"
check "the tree is clean afterwards"      "" "$(git status --porcelain)"
teardown

# Four, which is where Q7 measured mixing at 24/50 and where the confirmation
# stops being a formality.
setup_real 4
groups a.txt b.txt c.txt d.txt > "$ANSWERS/commit"
ship --yes >/dev/null 2>&1
check "four changes land four commits" "chore: touch d,chore: touch c,chore: touch b,chore: touch a" "$(git log --format='%s' -4 | paste -sd,)"
check "each carrying one file"         "d.txt,c.txt,b.txt,a.txt" \
  "$(for r in HEAD HEAD~1 HEAD~2 HEAD~3; do git show --name-only --format= "$r"; done | paste -sd,)"
teardown

# A hook that rewrites the group's files and then aborts is the formatter case:
# the tree moved, so a retry can help, and every commit still lands. It fires
# once, because a hook that failed for ever would be the other case.
setup_real 3
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
git diff --cached --name-only | grep -qx c.txt || exit 0
[ -f .git/rewrote ] && exit 0
: > .git/rewrote
echo reformatted >> c.txt
exit 1
HOOK
chmod +x .git/hooks/pre-commit
groups a.txt b.txt c.txt > "$ANSWERS/commit"
ship --yes >/dev/null 2>&1; rc=$?
check "a hook that rewrote the tree exits 0" "0" "$rc"
check "and all three commits land"           "chore: touch c,chore: touch b,chore: touch a" "$(git log --format='%s' -3 | paste -sd,)"
check "and the retry took what it wrote"     "1" "$(git show HEAD:c.txt | grep -c reformatted)"
teardown

# A hook that only rejected gets no retry, because with the tree unchanged a
# retry is theatre. What landed stands, and 8 is what says so.
setup_real 3
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
git diff --cached --name-only | grep -qx c.txt && exit 1
exit 0
HOOK
chmod +x .git/hooks/pre-commit
groups a.txt b.txt c.txt > "$ANSWERS/commit"
out=$(ship --yes 2>&1); rc=$?
br=$(git branch --format='%(refname:short)' | grep '^lm-ship-')
check "a rejecting hook exits 8"          "8" "$rc"
check "the earlier commits stand"         "chore: touch b,chore: touch a" "$(git log --format='%s' -2 "$br" 2>/dev/null | paste -sd,)"
check "on a branch that survives 8"       "1" "$(git branch --list 'lm-ship-*' | wc -l)"
check "main did not move"                 "chore: seed" "$(git log -1 --format='%s' main)"
check "stderr names what landed"          "1" "$(grep -c 'landed: chore: touch a' <<<"$out")"
check "and what is left"                  "1" "$(grep -c 'left uncommitted' <<<"$out")"
check "and pr never ran"                  "0" "$(grep -c 'PR opened' <<<"$out")"
teardown

# The same rejection on a group that is not the last, which is the only shape that
# tells the two hook probes apart. Every later group's files sit at HEAD in the
# narrowed index and dirty in the tree, so a probe asked about the whole tree
# answers 1 and retries a rejection no retry can help; asked about the group's own
# files it answers 0. Measured 2026-08-30 in a throwaway repository: whole tree 1,
# `git diff --quiet -- b.txt` 0. The exit code cannot say it either, because a
# retried rejection lands nowhere and reports 8 just the same, so what the case
# reads is how many times the hook ran.
setup_real 3
cat > .git/hooks/pre-commit <<'HOOK'
#!/bin/sh
git diff --cached --name-only | grep -qx b.txt || exit 0
echo tried >> .git/rejected
exit 1
HOOK
chmod +x .git/hooks/pre-commit
groups a.txt b.txt c.txt > "$ANSWERS/commit"
out=$(ship --yes 2>&1); rc=$?
br=$(git branch --format='%(refname:short)' | grep '^lm-ship-')
check "a rejection mid-series exits 8"     "8" "$rc"
check "the commit before it stands"        "chore: touch a" "$(git log --format='%s' -1 "$br" 2>/dev/null)"
check "and the rejection was not retried"  "1" "$(wc -l < .git/rejected)"
check "and every uncommitted file is named" "2" "$(grep -cE '^  [bc]\.txt$' <<<"$out")"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
