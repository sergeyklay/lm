#!/usr/bin/env bash
# apply() from tools/pr.sh, the one apply that publishes to a forge, driven
# through libexec/lm-verb against a throwaway repository whose only remote is a
# bare repository beside it, with a recording `gh` on PATH. Both lines it runs
# are here: the push, where it lands, what `gh pr create` is handed, that the
# forge is never asked about a branch it has not been sent, what the forge says
# back, and what a refusal leaves behind.
#
# The three cases under tests/golden/pr pin the four read-only functions and
# stub confirm away; tests/ship.sh writes a pr.sh of its own; tests/consent.sh
# greps this file rather than running it. Nothing else reaches these two lines.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
ROOT=$(cd "$ROOT" && pwd)
PATH0=$PATH
fail=0

command -v script >/dev/null ||
  { echo "tests/pr-push.sh needs util-linux script: confirm reads /dev/tty"; exit 1; }

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

export GIT_AUTHOR_NAME=lm GIT_AUTHOR_EMAIL=lm@example.invalid
export GIT_COMMITTER_NAME=lm GIT_COMMITTER_EMAIL=lm@example.invalid
export BRANCH=feat/widen

NOTPL='{"title":"feat: widen the file","body":"Widens f.txt by one line so the pull request has something to describe."}'
TPL='{"title":"feat: widen the file","sections":{"scope":"**Type:** Feat","risk":"- **Breaking Changes:** No"}}'
BODY='Widens f.txt by one line so the pull request has something to describe.'
# What a real `gh pr create` prints on success, and the whole of what the run is
# for. No line of `lm` names it: the tool never reads it back and the runner
# inherits the stream, so the forge writes it straight onto the operator's screen.
PR_URL='https://github.invalid/acme/widget/pull/42'
TEMPLATE='### Scope

**Type:** [Feat | Fix]

### Risk

- **Breaking Changes:** [Yes | No]
'
BODY_TPL='### Scope

**Type:** Feat

### Risk

- **Breaking Changes:** No'

setup() { # $1 model reply, $2 pull request template or empty for none
  work=$(mktemp -d); mkdir -p "$work/bin" "$work/replies" "$work/gh"
  printf '%s' "$1" > "$work/replies/1"
  cat > "$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$REPLIES/n" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$REPLIES/n"
cat > "$REPLIES/req.$n"
cat "$REPLIES/$n" 2>/dev/null
EOF
  # Records the arguments one per file, so a multi-line body comes back the way
  # it was passed, and what the remote held at the moment of the call: a pull
  # request against a branch the forge has not seen is what the order inside
  # apply() exists to prevent, and only the call itself can report it. Then it
  # answers the way the forge does, on stdout, so the carriage can be read.
  cat > "$work/bin/gh" <<'EOF'
#!/usr/bin/env bash
i=0; for a in "$@"; do i=$((i+1)); printf '%s' "$a" > "$GH/arg.$i"; done
printf '%s' "$i" > "$GH/argc"
git --git-dir="$ORIGIN" rev-parse -q --verify "refs/heads/$BRANCH" > "$GH/remote" 2>/dev/null ||
  printf 'missing' > "$GH/remote"
printf '%s\n' "$PR_URL"
EOF
  chmod +x "$work/bin/curl" "$work/bin/gh"
  export REPLIES="$work/replies" GH="$work/gh" PATH="$work/bin:$PATH0" PR_URL \
    LM_TOOLS="$ROOT/tools" LM_LOG="$work/runs.jsonl" ORIGIN="$work/origin.git"
  # A real gh sits on this machine's PATH and would open a real pull request.
  [ "$(command -v gh)" = "$work/bin/gh" ] ||
    { echo "tests/pr-push.sh: gh is $(command -v gh), not the stub"; exit 1; }
  git init -q --bare "$ORIGIN"
  repo="$work/repo"; mkdir -p "$repo"; cd "$repo" || exit 1
  git init -q -b main .
  git remote add origin "$ORIGIN"
  [ -z "$2" ] || { mkdir -p .github; printf '%s' "$2" > .github/pull_request_template.md; }
  printf 'base\n' > f.txt
  git add .; git commit -qm "chore: seed the repository"
  git push -q origin main
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
  git checkout -q -b "$BRANCH"
  printf 'base\nwidened\n' > f.txt
  git add f.txt; git commit -qm "feat: widen the file"
  HEAD1=$(git rev-parse HEAD)
}

teardown() { cd /; rm -rf "$work"; }

reply() { jq -nc --arg c "$1" '{message:{content:$c},done_reason:"stop"}'; }
# script owns the terminal it lends to confirm, and echoes back through it.
tty_lm() { local a=$1; shift; script -qec "$ROOT/libexec/lm-verb $*" /dev/null <<<"$a" | tr -d '\r'; }
arg() { cat "$GH/arg.$1" 2>/dev/null; }

# The pull request the operator approves.
setup "$(reply "$NOTPL")" ""
out=$(tty_lm y pr 2>&1); rc=$?
check "an approved pr exits 0"          "0" "$rc"
check "the branch reached the remote"   "$HEAD1" \
  "$(git --git-dir="$ORIGIN" rev-parse "refs/heads/$BRANCH")"
check "and the branch tracks it"        "origin/$BRANCH" \
  "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')"
check "gh is asked to create a pull request" "pr create" "$(arg 1) $(arg 2)"
check "with the title the model wrote"  "--title feat: widen the file" "$(arg 3) $(arg 4)"
check "and the body render assembled"   "--body $BODY" "$(arg 5) $(arg 6)"
check "and nothing else on the command line" "6" "$(cat "$GH/argc")"
check "the remote already held the branch when gh was called" "$HEAD1" "$(cat "$GH/remote")"
# The URL is the whole of what the operator takes away, and nothing in `lm` puts
# it there: it falls through the inherited stream to the terminal. So this is the
# case that goes red the first time an apply() reads gh's output for itself.
#
# The last word rather than the last line, because the terminal supplies no
# newline of its own: with the push deleted the URL lands on the end of the
# echoed confirmation prompt, and the URL still being what the operator reads
# last is the property here, not which line the push left it on.
last=$(printf '%s\n' "$out" | tail -n1)
check "and the forge's answer is the last thing he reads" "$PR_URL" "${last##* }"
teardown

# A template turns the body into the headings the repository owns and the model
# never sees. render pins that; this is the same text reaching the forge.
setup "$(reply "$TPL")" "$TEMPLATE"
tty_lm y pr >/dev/null 2>&1
check "a template body reaches gh with its headings" "$BODY_TPL" "$(arg 6)"
teardown

# A refusal publishes nothing. This is the case the confirmation exists for.
setup "$(reply "$NOTPL")" ""
tty_lm n pr >/dev/null 2>&1; rc=$?
check "a refused pr exits 7"            "7" "$rc"
check "and a refusal pushes nothing"    "refs/heads/main" \
  "$(git --git-dir="$ORIGIN" for-each-ref --format='%(refname)' | paste -sd' ')"
check "and never calls gh"              "" "$(cat "$GH/argc" 2>/dev/null)"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
