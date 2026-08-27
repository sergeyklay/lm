#!/usr/bin/env bash
# Exercises apply() from tools/issue.sh, which is the one apply whose command
# line no other suite sees: every other verb hands its command what render has
# already printed, and this one assembles a --label list from what the human
# typed. `gh` is a stub on PATH that records its arguments and is never the real
# one, so nothing here can create an issue.
#
# The test plays the runner: `ask` and `confirm` are the runner's to provide, so
# the cases define them the way src/registry.mts does and vary the answer.

set -uo pipefail

ROOT=$(dirname "$(readlink -f "$0")")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$GH_ARGS"
STUB
chmod +x "$WORK/gh"
PATH="$WORK:$PATH"

fail=0

check() { # name, want, got
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    printf 'FAIL %s\n  want: %s\n  got:  %s\n' "$1" "$2" "$3"
    fail=1
  fi
}

# Runs apply() with one answer and one reply, and prints the arguments `gh`
# received, one per line. The prompt `ask` was given is left in $WORK/asked.
run() { # $1 answer JSON, $2 reply to the labels question, $3 confirm y/n
  export GH_ARGS="$WORK/args"
  : > "$GH_ARGS"
  : > "$WORK/asked"
  ANSWER=$1 REPLY_TO_ASK=$2 CONFIRM=$3 bash -euo pipefail -c '
    ask() { printf "%s" "$1" > "'"$WORK"'/asked"; printf "%s" "$REPLY_TO_ASK"; }
    confirm() { [ "$CONFIRM" = y ] || exit 7; }
    . "'"$ROOT"'/../tools/issue.sh"
    printf "%s" "$ANSWER" | apply
  ' >/dev/null 2>&1
  # The caller reads this through a command substitution, which is a subshell, so
  # the status comes back through a file rather than through $?.
  printf '%s' "$?" > "$WORK/status"
  cat "$GH_ARGS"
}

labels_of() { grep -A1 -- '--label' | grep -v -- '--label\|^--$' | paste -sd, -; }

TWO='{"title":"Runner drops the retry","body":"Body.","labels":["bug","ci"]}'
NONE='{"title":"No labels","body":"Body.","labels":[]}'

out=$(run "$TWO" "" y)
check "an empty reply keeps the labels the model proposed" "bug,ci" "$(labels_of <<<"$out")"
check "and the question showed them" "Labels (bug, ci):" "$(cat "$WORK/asked")"
check "and the title reaches gh" "Runner drops the retry" "$(sed -n '4p' <<<"$out")"

out=$(run "$TWO" "docs, ci" y)
check "a typed reply replaces them, trimmed" "docs,ci" "$(labels_of <<<"$out")"

out=$(run "$TWO" "none" y)
check "the word none means no label at all" "" "$(labels_of <<<"$out")"
check "and gh is still asked to create the issue" "issue" "$(sed -n '1p' <<<"$out")"

out=$(run "$TWO" "bug,,ci," y)
check "empty items in a reply are dropped" "bug,ci" "$(labels_of <<<"$out")"

out=$(run "$NONE" "" y)
check "an answer with no labels asks about none" "Labels (none):" "$(cat "$WORK/asked")"
check "and hands gh no label" "" "$(labels_of <<<"$out")"

out=$(run "$TWO" "" n)
check "a declined confirmation exits 7" "7" "$(cat "$WORK/status")"
check "and gh is never called" "" "$out"

# The same apply under the capability, where the runner supplies the YES prelude
# instead: nobody is asked, so the empty answer is what the tool reads, and what an
# empty answer means stays its own decision - here, keeping what the model proposed.
export GH_ARGS="$WORK/args"; : > "$GH_ARGS"
ANSWER=$TWO bash -euo pipefail -c '
  confirm() { :; }; ask() { :; }
  . "'"$ROOT"'/../tools/issue.sh"
  printf "%s" "$ANSWER" | apply
' >/dev/null 2>&1
unattended=$?
check "an unattended run reaches gh"        "0"      "$unattended"
check "and keeps the labels the model proposed" "bug,ci" "$(labels_of < "$GH_ARGS")"

if [ "$fail" -ne 0 ]; then echo FAILED; exit 1; fi
echo "all cases passed"
