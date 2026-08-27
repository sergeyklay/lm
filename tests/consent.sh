#!/usr/bin/env bash
# The two halves of R20's answer: a question nobody is there to answer, and a run
# that says in advance that nobody will be.
#
# The timeout is 120 seconds, which no test can afford to wait for, so the cases
# take the shipped text of the reading function out of the runner and substitute
# only the number. What that leaves unproven is the number itself, so the first
# case asserts it directly and asserts that both runners carry the same one.
#
# The capability's own behaviour needs no terminal and is covered where it lives:
# tests/registry.mts drives apply() with and without it, and tests/issue-labels.sh
# drives a tool that asks a question under it.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
fail=0

command -v script >/dev/null ||
  { echo "tests/consent.sh needs util-linux script: confirm reads /dev/tty"; exit 1; }

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

# One number, in both runners, findable by a person who wants to argue with it.
node_seconds=$(grep -oE 'CONFIRM_TIMEOUT_SECONDS = [0-9]+' "$ROOT/src/registry.mts" | grep -oE '[0-9]+')
bash_seconds=$(grep -oE '^CONFIRM_TIMEOUT_SECONDS=[0-9]+' "$ROOT/libexec/lm-verb" | grep -oE '[0-9]+')
check "the Node runner names its bound"     "120" "$node_seconds"
check "the shell runner carries the twin"   "120" "$bash_seconds"
check "and the reading is bounded by it"    "1"   "$(grep -c 'read -r -t' "$ROOT/libexec/lm-verb")"
# The Node prelude's own timeout branch is read here rather than driven: its line is
# built from the constant above and the behaviour of that line is what the pty cases
# below prove on its twin. What a text check can still catch is the branch being
# dropped or the bound being spelled in by hand.
check "the Node reading is bounded too"     "1"   "$(grep -c 'read -r -t \${CONFIRM_TIMEOUT_SECONDS}' "$ROOT/src/registry.mts")"
check "and it says why it stopped"          "1"   "$(grep -c 'no answer in \${CONFIRM_TIMEOUT_SECONDS}s' "$ROOT/src/registry.mts")"

# The shipped functions, with the wait cut to a second. Everything else is the
# text the runner installs, so a change to the line reaches these cases.
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
{ sed -n '/^_read()/,/^  \[ "\$rc" = 0 \]/p' "$ROOT/libexec/lm-verb"
  sed -n '/^confirm()/,/^ask()/p' "$ROOT/libexec/lm-verb"
} | sed 's/CONFIRM_TIMEOUT_SECONDS=120/CONFIRM_TIMEOUT_SECONDS=1/' > "$work/lines.sh"
{ echo 'CONFIRM_TIMEOUT_SECONDS=1'; cat "$work/lines.sh"
  echo 'confirm "go?"'; echo 'echo APPLIED'; } > "$work/subject.sh"
bash -n "$work/subject.sh" || { echo "FAIL the extracted lines do not parse"; exit 1; }

# A pty with nobody typing at it is the case that used to block: the fifo holds the
# terminal open, and what comes back has to be the verb's own exit rather than the
# harness's 124.
# The feeder has to outlive the harness. A feeder that ends first closes the fifo,
# the blocked read fails at end of input and exits 7 by that route, and a case
# reading only the status cannot tell a bound that held from a terminal that went
# away - measured: with the bound removed, this returned 7 either way.
under_pty() { # $1 what to feed the pty
  rm -f "$work/fifo"; mkfifo "$work/fifo"
  eval "$1" > "$work/fifo" & local feeder=$!
  timeout 20 script -qec "bash $work/subject.sh" /dev/null < "$work/fifo" > "$work/out" 2>&1
  local rc=$?
  kill "$feeder" 2>/dev/null; wait "$feeder" 2>/dev/null
  echo "$rc"
}

rc=$(under_pty 'sleep 60')
check "nobody typing reaches a decision"      "7" "$rc"
check "and nothing is applied"                "0" "$(grep -c APPLIED "$work/out")"
check "and the run says why it stopped"       "1" "$(grep -c 'no answer in 1s' "$work/out")"

rc=$(under_pty '{ sleep 0.2; printf "y\n"; sleep 60; }')
check "an answer in time still applies"       "0" "$rc"
check "and applies exactly once"              "1" "$(grep -c APPLIED "$work/out")"
check "and the timeout says nothing"          "0" "$(grep -c 'no answer in' "$work/out")"

rc=$(under_pty '{ sleep 0.2; printf "n\n"; sleep 60; }')
check "a refusal is still a refusal"          "7" "$rc"
check "and is not reported as a timeout"      "0" "$(grep -c 'no answer in' "$work/out")"

# The variable is the half a composition reaches: lm ship drives the shell runner,
# which never sees the flag. Without a terminal at all, so the capability is the only
# thing that can let it through.
cat > "$work/unattended.sh" <<'INNER'
LM_YES=1
INNER
{ sed -n '/^_read()/,/^  \[ "\$rc" = 0 \]/p' "$ROOT/libexec/lm-verb"
  sed -n '/^confirm()/,/^ask()/p' "$ROOT/libexec/lm-verb"
  echo 'a=$(ask "labels:")'; echo 'confirm "go?"'; echo "printf 'APPLIED[%s]' \"\$a\""
} >> "$work/unattended.sh"
bash -n "$work/unattended.sh" || { echo "FAIL the unattended lines do not parse"; exit 1; }
got=$(bash "$work/unattended.sh" </dev/null 2>&1); rc=$?
check "the variable lets a run through with no terminal" "0" "$rc"
check "and the unasked question answered an empty line" "APPLIED[]" "$got"
unset_got=$(bash -c 'unset LM_YES; sed -i "1d" "$1"; bash "$1"' _ "$work/unattended.sh" </dev/null 2>&1); unset_rc=$?
check "and without it the same run still refuses"        "7" "$unset_rc"

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
