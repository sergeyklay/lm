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
# The Node prelude's own timeout branch is read here rather than driven: its lines
# are built from the constant above and the behaviour of them is what the pty cases
# below prove on its twin. What a text check can still catch is the branch being
# dropped or the bound being spelled in by hand.
check "the Node deadline names the bound"   "1"   "$(grep -c '_deadline() { DEADLINE=\$(( \$(date +%s) + \${CONFIRM_TIMEOUT_SECONDS} ))' "$ROOT/src/registry.mts")"
check "and it says why it stopped"          "1"   "$(grep -c 'no answer in \${CONFIRM_TIMEOUT_SECONDS}s' "$ROOT/src/registry.mts")"

# The partition, the message and the deadline, in both runners, for the same reason
# the bound is: the shell arm is driven under a pty below and the Node arm is read
# here, because the two are built from the same shape and only one of them is cheap
# to put a terminal in front of.
for f in libexec/lm-verb src/registry.mts; do
  check "$f takes y and yes for a yes"      "1" "$(grep -Fc '[yY]|[yY][eE][sS])' "$ROOT/$f")"
  check "$f takes n, no and nothing for no" "1" "$(grep -Fc '[nN]|[nN][oO]' "$ROOT/$f")"
  check "$f asks again in the same words"   "1" "$(grep -Fc 'Please answer y or n.' "$ROOT/$f")"
  check "$f puts no program name on it"     "0" "$(grep -c 'lm:.*answer y or n' "$ROOT/$f")"
  check "$f loops rather than asking twice" "1" "$(grep -Fc '[ "$v" = 2 ] || break' "$ROOT/$f")"
  check "$f bounds the whole confirmation"  "1" "$(grep -Fc '_deadline() { DEADLINE=$(( $(date +%s) + ' "$ROOT/$f")"
  check "$f reads only what is left of it"  "1" "$(grep -Fc 'left=$(( DEADLINE - $(date +%s) ))' "$ROOT/$f")"
done

# The shipped functions, with the wait cut to five seconds. Everything else is the
# text the runner installs, so a change to the line reaches these cases. One range
# rather than two, so a function added between _read and ask is carried along
# instead of being left out of every case here without saying so.
#
# Five and not one, because the bound is a deadline for the whole confirmation: a
# case that answers three times and reads the re-asks between them has to fit
# several answers inside the one number, and a second does not hold them.
shipped() { sed -n '/^_read()/,/^ask()/p' "$ROOT/libexec/lm-verb"; }
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
shipped | sed 's/CONFIRM_TIMEOUT_SECONDS=120/CONFIRM_TIMEOUT_SECONDS=5/' > "$work/lines.sh"
# The runner's own flags, because confirm reads a status out of a function call and
# set -e is what decides whether that reading is reached.
{ echo 'set -euo pipefail'; echo 'CONFIRM_TIMEOUT_SECONDS=5'; cat "$work/lines.sh"
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
check "and the run says why it stopped"       "1" "$(grep -c 'no answer in 5s' "$work/out")"

asked() { grep -o 'go?' "$work/out" | wc -l | tr -d ' '; }
# A pty ends every line with a CR, which a whole-line comparison would otherwise
# read as part of the message.
reasked() { tr -d '\r' < "$work/out" | grep -Fxc 'Please answer y or n.'; }

rc=$(under_pty '{ sleep 0.2; printf "y\n"; sleep 60; }')
check "an answer in time still applies"       "0" "$rc"
check "and applies exactly once"              "1" "$(grep -c APPLIED "$work/out")"
check "and the timeout says nothing"          "0" "$(grep -c 'no answer in' "$work/out")"
check "and the question was put once"         "1" "$(asked)"
check "and nothing was queried a second time" "0" "$(reasked)"

# The half the strict comparison used to throw away. confirm runs after the model
# call, so a shift key is not a decision to discard a finished answer over.
rc=$(under_pty '{ sleep 0.2; printf "Y\n"; sleep 60; }')
check "an uppercase Y is a yes"               "0" "$rc"
check "and Y applies exactly once"            "1" "$(grep -c APPLIED "$work/out")"
check "and Y is asked once"                   "1" "$(asked)"

rc=$(under_pty '{ sleep 0.2; printf "yes\n"; sleep 60; }')
check "the word yes is a yes"                 "0" "$rc"
check "and yes applies exactly once"          "1" "$(grep -c APPLIED "$work/out")"
check "and yes is asked once"                 "1" "$(asked)"

rc=$(under_pty '{ sleep 0.2; printf "n\n"; sleep 60; }')
check "a refusal is still a refusal"          "7" "$rc"
check "and is not reported as a timeout"      "0" "$(grep -c 'no answer in' "$work/out")"
check "and n applies nothing"                 "0" "$(grep -c APPLIED "$work/out")"
check "and n is not asked twice"              "1" "$(asked)"

rc=$(under_pty '{ sleep 0.2; printf "no\n"; sleep 60; }')
check "the word no is a refusal"              "7" "$rc"
check "and no applies nothing"                "0" "$(grep -c APPLIED "$work/out")"
check "and no is not asked twice"             "1" "$(asked)"

rc=$(under_pty '{ sleep 0.2; printf "\n"; sleep 60; }')
check "a bare empty line is a refusal"        "7" "$rc"
check "and the empty line applies nothing"    "0" "$(grep -c APPLIED "$work/out")"
check "and the empty line is not asked twice" "1" "$(asked)"

# Neither answer: the question is put again, saying what it wants, on a line that
# neither names the program nor echoes back what the terminal has already printed.
rc=$(under_pty '{ sleep 0.2; printf "u\n"; sleep 0.3; printf "y\n"; sleep 60; }')
check "a typo then a yes still applies"       "0" "$rc"
check "and applies exactly once after it"     "1" "$(grep -c APPLIED "$work/out")"
check "and the question was put twice"        "2" "$(asked)"
check "and the re-ask says what it wants"     "1" "$(reasked)"
check "and the re-ask names no program"       "0" "$(grep -c 'lm:.*answer y or n' "$work/out")"
check "and quotes nothing back at the human"  "0" "$(grep -c '\"u\"' "$work/out")"
check "and a re-ask is not a timeout"         "0" "$(grep -c 'no answer in' "$work/out")"

# No cap on the re-asks, so a typo can never discard a finished model answer. The
# second of the three is the byte glibc's ru_RU puts in noexpr and not in yesexpr,
# which is the answer the partition exists for.
rc=$(under_pty '{ sleep 0.2; printf "u\n"; sleep 0.3; printf "\xd0\xbd\n"; sleep 0.3; printf "?\n"; sleep 0.3; printf "y\n"; sleep 60; }')
check "three typos then a yes still applies"  "0" "$rc"
check "and three typos apply exactly once"    "1" "$(grep -c APPLIED "$work/out")"
check "and the question was put four times"   "4" "$(asked)"
check "and it was asked again once per typo"  "3" "$(reasked)"
check "and three typos are not a timeout"     "0" "$(grep -c 'no answer in' "$work/out")"

rc=$(under_pty '{ sleep 0.2; printf "u\n"; sleep 0.3; printf "n\n"; sleep 60; }')
check "a typo then a no is still a refusal"   "7" "$rc"
check "and a typo then a no applies nothing"  "0" "$(grep -c APPLIED "$work/out")"
check "and the question was put twice for it" "2" "$(asked)"
check "and that refusal is not a timeout"     "0" "$(grep -c 'no answer in' "$work/out")"

# The bound is a deadline for the whole confirmation, not for each reading. These
# answers arrive faster than it, so a bound started again on every reading would
# never fire and the loop would run until the harness killed it and reported 124.
t0=$(date +%s)
rc=$(under_pty 'while :; do printf "u\n"; sleep 0.2; done')
elapsed=$(( $(date +%s) - t0 ))
check "typing on past the deadline stops"     "7" "$rc"
check "and the deadline applies nothing"      "0" "$(grep -c APPLIED "$work/out")"
check "and the wait is what it reports"       "1" "$(grep -c 'no answer in 5s' "$work/out")"
check "and it stopped within twice the bound" "yes" "$([ "$elapsed" -le 10 ] && echo yes || echo no)"
check "and it asked again more than twice"    "yes" "$([ "$(reasked)" -gt 2 ] && echo yes || echo no)"

# The variable is the half a workflow reaches: lm ship drives the shell runner,
# which never sees the flag. Without a terminal at all, so the capability is the only
# thing that can let it through.
cat > "$work/unattended.sh" <<'INNER'
LM_YES=1
INNER
{ shipped
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
