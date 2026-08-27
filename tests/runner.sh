#!/usr/bin/env bash
# libexec/lm-verb with curl stubbed. What the tools cannot pin: dispatch, the single
# retry, and the exit code each failure leaves behind.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
PATH0=$PATH
fail=0

command -v script >/dev/null ||
  { echo "tests/runner.sh needs util-linux script: confirm reads /dev/tty"; exit 1; }

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

say() { jq -nc --arg c "$1" '{message:{content:$c},done_reason:"stop"}'; }
# The same reply with the numbers ollama sends beside it. 1.5 s of model time is
# chosen to be tellable from any wall clock a case here can produce.
say_timed() { jq -nc --arg c "$1" '{message:{content:$c},done_reason:"stop",
  total_duration:1500000000,load_duration:5000000,prompt_eval_count:26,
  prompt_eval_duration:237000000,eval_count:45,eval_duration:458000000}'; }
# The same reply the budget cut short: it parses, so only done_reason tells.
say_cut() { jq -nc --arg c "$1" '{message:{content:$c},done_reason:"length"}'; }

# Each argument is one model reply, taken in order. The stub keeps the request it
# was handed beside the reply it returned, so a case can assert what the retry was
# told as well as what came back.
setup() {
  work=$(mktemp -d); mkdir -p "$work/bin" "$work/tools" "$work/replies"
  local i=0 r
  for r in "$@"; do i=$((i + 1)); printf '%s' "$r" > "$work/replies/$i"; done
  cat > "$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$REPLIES/n" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$REPLIES/n"
cat > "$REPLIES/req.$n"
cat "$REPLIES/$n" 2>/dev/null
EOF
  chmod +x "$work/bin/curl"
  cat > "$work/tools/stub.sh" <<'EOF'
name="stub"
description="exercises the runner and nothing else"
collect() { [ "${1:-}" = refuse ] && { echo "lm: nothing to do" >&2; return 3; }; echo PROMPT; }
schema() { echo '{"type":"object"}'; }
validate() { local j; j=$(cat); [ "$j" = ok ] || echo "answer must be ok"; }
render() { cat; echo; }
apply() { confirm "Apply? [y/N]"; echo APPLIED; }
EOF
  export REPLIES="$work/replies" PATH="$work/bin:$PATH0" \
         LM_TOOLS="$work/tools" LM_LOG="$work/log.jsonl"
  cd "$work" || exit 1
}

teardown() { cd /; rm -rf "$work"; }

calls() { cat "$REPLIES/n" 2>/dev/null || echo 0; }
lm() { "$ROOT/libexec/lm-verb" "$@"; }
# script owns the terminal it lends to confirm, and echoes back through it.
tty_lm() { local a=$1; shift; script -qec "$ROOT/libexec/lm-verb $*" /dev/null <<<"$a" | tr -d '\r'; }

# Dispatch: an unknown verb says what there is, and reaches nothing.
setup
out=$(lm nosuch 2>&1); rc=$?
check "an unknown verb exits 2"        "2" "$rc"
check "it names the tools there are"   "  stub" "$(grep -m1 stub <<<"$out")"
check "it makes no model call"         "0" "$(calls)"
teardown

# A flag the tool never declared is a typo, and a typo must not become prompt text.
setup
lm stub --dry-runn >/dev/null 2>&1; rc=$?
check "an undeclared flag exits 2"     "2" "$rc"
check "a typo makes no model call"     "0" "$(calls)"
teardown

# collect refuses: the status is the tool's, and the model is never asked.
setup
lm stub refuse >/dev/null 2>&1; rc=$?
check "collect's refusal passes through" "3" "$rc"
check "a refusal makes no model call"    "0" "$(calls)"
teardown

# One clean answer: one call, and apply runs once the human agrees.
setup "$(say ok)"
out=$(tty_lm y stub); rc=$?
check "a clean answer exits 0" "0" "$rc"
check "one model call"         "1" "$(calls)"
check "apply ran"              "1" "$(grep -c APPLIED <<<"$out")"
teardown

# The two numbers a request carries: the window this route can set, and the budget
# both routes spend. `num_predict` is the answer's ceiling here and `max_tokens`
# there, so a run that reads one variable and not the other answers at two lengths.
setup "$(say ok)"
LM_CTX=8192 LM_MAX_TOKENS=64 tty_lm y stub >/dev/null
check "the window reaches the server on this route" "8192" "$(jq -r '.options.num_ctx' "$REPLIES/req.1")"
check "and the budget is the variable's"            "64"   "$(jq -r '.options.num_predict' "$REPLIES/req.1")"
teardown

setup "$(say ok)"
tty_lm y stub >/dev/null
check "unset, the budget is the published default" "3000" "$(jq -r '.options.num_predict' "$REPLIES/req.1")"
teardown

# The retry is single, and it carries the violations: they are its only input.
setup "$(say bad)" "$(say ok)"
tty_lm y stub >/dev/null; rc=$?
check "the retry succeeds"       "0" "$rc"
check "exactly two model calls"  "2" "$(calls)"
check "the retry was told why"   "1" "$(grep -c 'answer must be ok' "$REPLIES/req.2")"
teardown

# Two rejections stop the run and show the draft that was refused.
setup "$(say bad)" "$(say worse)"
out=$(lm stub 2>&1); rc=$?
check "two rejections exit 4"  "4" "$rc"
check "and buy no third call"  "2" "$(calls)"
check "the draft is shown"     "worse" "$(grep -A1 -m1 -- '--- draft ---' <<<"$out" | tail -1)"
teardown

# Empty content is a failure whatever done_reason says.
setup "$(say '')"
lm stub >/dev/null 2>&1; rc=$?
check "empty content exits 5"  "5" "$rc"
check "and is not retried"     "1" "$(calls)"
# The two halves of the record fall separately. A run that asked and got nothing
# keeps its prompt hash, so the log tells it from a verb that refused before there
# was a prompt at all, and a length of zero is the answer rather than its absence.
e1=$(jq -r '.prompt_hash' "$work/log.jsonl")
check "an empty answer still hashes the prompt" "64"   "${#e1}"
check "and reports a length of zero"            "0"    "$(jq -r '.answer_len' "$work/log.jsonl")"
check "with no answer to hash"                  "null" "$(jq -r '.answer_hash' "$work/log.jsonl")"
teardown

setup "$(say bad)" "$(say '')"
lm stub >/dev/null 2>&1; rc=$?
check "empty on the retry exits 5" "5" "$rc"
teardown

# A cut-off answer is a failure even when it parses and would have validated.
setup "$(say_cut ok)"
out=$(lm stub 2>&1); rc=$?
check "a cut-off answer exits 5"   "5" "$rc"
check "and says it was cut off"    "1" "$(grep -c 'cut off' <<<"$out")"
check "and is not retried"         "1" "$(calls)"
teardown

setup "$(say bad)" "$(say_cut ok)"
lm stub >/dev/null 2>&1; rc=$?
check "cut off on the retry exits 5" "5" "$rc"
teardown

# Declining is exit 7, and it is not a failure: nothing was applied.
setup "$(say ok)"
out=$(tty_lm n stub); rc=$?
check "declining exits 7"    "7" "$rc"
check "nothing was applied"  "0" "$(grep -c APPLIED <<<"$out")"
teardown

# --dry-run renders and stops before the side effect, without asking.
setup "$(say ok)"
out=$(lm stub --dry-run 2>&1); rc=$?
check "--dry-run exits 0"      "0" "$rc"
check "it rendered the answer" "ok" "$(head -1 <<<"$out")"
check "it applied nothing"     "0" "$(grep -c APPLIED <<<"$out")"
teardown

# An emptied LM_LOG keeps a run out of the log. HOME is set so that a regression
# lands inside the fixture instead of the operator's own log, which is where the
# default path sent it. The first run is the control: without it the case would
# pass on a runner that never logs at all.
setup
lm stub refuse >/dev/null 2>&1
check "a run is logged"                "1" "$(wc -l < "$work/log.jsonl")"
HOME="$work" LM_LOG='' lm stub refuse >/dev/null 2>&1
check "an emptied LM_LOG logs nothing" "" "$(cat "$work/.lm/runs.jsonl" 2>/dev/null)"
teardown

# The runner copies the composition into the record, and records none when there
# was none. This is the half tests/ship.sh cannot see: there the verb is stubbed.
setup
LM_COMPOSITION=ship-42 lm stub refuse >/dev/null 2>&1
check "a composed run names it" "ship-42" "$(jq -r '.composition' "$work/log.jsonl")"
lm stub refuse >/dev/null 2>&1
check "a typed run names none"  "null"    "$(jq -r '.composition' "$work/log.jsonl" | tail -1)"
teardown

# --which can say that nothing serves the request. Without a refusal member the
# enum forces a verb, and §9.3's «a task that cannot be named as a verb» signal has
# no surface able to report it.
setup "$(say '{"tool":"none"}')"
err=$(lm --which "brew me a coffee" 2>&1 >"$work/out.txt"); rc=$?
check "an unserved request exits 2"   "2" "$rc"
check "it says so"                    "1" "$(grep -c 'no verb serves' <<<"$err")"
check "and names no verb on stdout"   ""  "$(cat "$work/out.txt")"
teardown

setup "$(say '{"tool":"stub"}')"
check "a served request still answers" "stub" "$(lm --which "exercise the runner" 2>/dev/null)"
teardown

# The refusal member is in the enum the model is given, not only in the prose.
setup "$(say '{"tool":"stub"}')"
lm --which "anything" >/dev/null 2>&1
check "none is offered in the schema" "true" "$(jq -r '.format.properties.tool.enum|contains(["none"])' "$REPLIES/req.1")"
teardown

# A --which run reaches the log whichever way it answers, because the signal is a
# share: refusals alone are a numerator without a denominator. The record names
# no verb, so lm-stats keeps it out of the verb table and counts it on its own.
setup "$(say '{"tool":"stub"}')" "$(say '{"tool":"none"}')"
lm --which "exercise the runner" >/dev/null 2>&1
lm --which "brew me a coffee"    >/dev/null 2>&1
check "both --which runs are logged"  "2"        "$(wc -l < "$work/log.jsonl")"
check "a match names the verb it found" "stub"   "$(jq -r '.which' "$work/log.jsonl" | head -1)"
check "a refusal is told from a match"  "none"   "$(jq -r '.which' "$work/log.jsonl" | tail -1)"
check "the record is not a verb"        "--which" "$(jq -r '.verb' "$work/log.jsonl" | head -1)"
out=$("$ROOT/libexec/lm-stats" 2>&1)
check "the verb table excludes it"  "0" "$(sed -n '2,/^$/p' <<<"$out" | grep -c -- --which)"
check "lm-stats reports the share"  "1 of 2" \
  "$(grep -A1 'found no verb for' <<<"$out" | tail -1 | tr -s ' ' | sed 's/^ //')"
teardown

# A verb run carries the field too, empty: one shape, so nothing has to know
# which kind of record it is holding before it can read one.
setup
lm stub refuse >/dev/null 2>&1
check "a verb run names no which" "null" "$(jq -r '.which' "$work/log.jsonl")"
teardown

# The prompt hash is a function of what collect() wrote, so a repository that did
# not change hashes the same and an edit to the tool moves it. Storing the prompt
# would drag the diff along; a hash drags nothing.
setup "$(say ok)" "$(say ok)" "$(say ok)"
lm stub --dry-run >/dev/null 2>&1
lm stub --dry-run >/dev/null 2>&1
p1=$(jq -r '.prompt_hash' "$work/log.jsonl" | head -1)
check "the prompt hash is a sha256"        "64" "${#p1}"
check "an unchanged tool hashes the same"  "$p1" "$(jq -r '.prompt_hash' "$work/log.jsonl" | tail -1)"
check "the answer's length is recorded"    "2"  "$(jq -r '.answer_len' "$work/log.jsonl" | head -1)"
a1=$(jq -r '.answer_hash' "$work/log.jsonl" | head -1)
check "and the answer is hashed too"       "64" "${#a1}"
sed -i 's/echo PROMPT/echo OTHER/' "$work/tools/stub.sh"
# sed exits 0 having matched nothing, and an edit that did not happen would leave
# the hash equal for the right reason and the case red for the wrong one.
check "the tool was really edited" "1" "$(grep -c 'echo OTHER' "$work/tools/stub.sh")"
lm stub --dry-run >/dev/null 2>&1
check "an edit to collect moves the hash" "moved" \
  "$([ "$p1" = "$(jq -r '.prompt_hash' "$work/log.jsonl" | tail -1)" ] && echo same || echo moved)"
teardown

# A run that never asked has no prompt and no answer, and null says so. An answer
# of length zero is a different thing and exit 5 is what reports it.
setup
lm stub refuse >/dev/null 2>&1
check "a refused run hashes no prompt" "null" "$(jq -r '.prompt_hash' "$work/log.jsonl")"
check "and records no answer length"   "null" "$(jq -r '.answer_len' "$work/log.jsonl")"
teardown

# --which carries the three fields too: its prompt is the catalogue, so the hash
# moves when the registry does, and one shape means no reader has to branch.
setup "$(say '{"tool":"stub"}')"
lm --which "exercise the runner" >/dev/null 2>&1
w1=$(jq -r '.prompt_hash' "$work/log.jsonl")
check "a --which run hashes its prompt" "64" "${#w1}"
teardown

# ms is wall clock and the log_run trap fires after apply(), where the tool waits
# on /dev/tty, so the operator's deliberation is inside it. The model's own time
# is not, and the gap is what this pins: apply sleeps, ms moves, the model time
# does not budge from what the reply itself reported.
setup "$(say_timed ok)"
sed -i 's/^apply() { confirm/apply() { sleep 1.2; confirm/' "$work/tools/stub.sh"
check "the stub really sleeps in apply" "1" "$(grep -c 'sleep 1.2' "$work/tools/stub.sh")"
tty_lm y stub >/dev/null
check "the model time is the reply's own"    "1500000000" "$(jq -r '.total_duration' "$work/log.jsonl")"
check "and the token counts came through"    "26 45" \
  "$(jq -r '[.prompt_eval_count, .eval_count] | @tsv' "$work/log.jsonl" | tr '\t' ' ')"
check "while the wall clock carries the wait" "yes" \
  "$([ "$(jq -r '.ms' "$work/log.jsonl")" -ge 1200 ] && echo yes || echo no)"
teardown

# A retry is two lots of model work, and one record has to say so: the numbers
# are summed over the calls a run made, not taken from the last one.
setup "$(say_timed bad)" "$(say_timed ok)"
tty_lm y stub >/dev/null
check "a retried run counts two calls"   "2"          "$(jq -r '.calls' "$work/log.jsonl")"
check "and sums both lots of model time" "3000000000" "$(jq -r '.total_duration' "$work/log.jsonl")"
check "and both lots of tokens"          "90"         "$(jq -r '.eval_count' "$work/log.jsonl")"
teardown

# A reply that carries no numbers leaves them null rather than zero: zero
# nanoseconds of model work would be a claim, and none was made.
setup "$(say ok)"
lm stub --dry-run >/dev/null 2>&1
check "an untimed reply records no model time" "null" "$(jq -r '.total_duration' "$work/log.jsonl")"
check "and no token counts"                    "null" "$(jq -r '.eval_count' "$work/log.jsonl")"
teardown

# lm-stats reports the model time in a column of its own, and says so rather
# than averaging in the runs that predate the field.
# A --dry-run is kept out of the table by design, so these have to be real runs.
setup "$(say_timed ok)" "$(say ok)"
tty_lm y stub >/dev/null
tty_lm y stub >/dev/null
out=$("$ROOT/libexec/lm-stats" --all 2>&1)
check "the table has a model column"  "1" "$(head -1 <<<"$out" | grep -c 'avg model')"
check "and reports the reply's time"  "1500" "$(awk '/^stub /{print $NF}' <<<"$out")"
teardown

# clean is read against a threshold, so it carries the sample that threshold needs
# and withholds itself below it. Two runs cannot put the edit share under one in
# five however they land, and a column that answered anyway would answer the same
# whatever the log held.
setup "$(say ok)" "$(say ok)"
tty_lm y stub >/dev/null
tty_lm y stub >/dev/null
out=$("$ROOT/libexec/lm-stats" 2>&1)
check "two runs are counted"          "2"    "$(awk '/^stub /{print $2}' <<<"$out")"
check "and the clean share withheld"  "n<14" "$(awk '/^stub /{print $3}' <<<"$out")"
teardown

# Fourteen is where it starts being read, because fourteen is the smallest sample
# a share below one in five is reachable from at all. The positive control: without
# it the column could withhold every share and this suite would not notice.
replies=(); for _ in $(seq 14); do replies+=("$(say ok)"); done
setup "${replies[@]}"
for _ in $(seq 14); do tty_lm y stub >/dev/null; done
out=$("$ROOT/libexec/lm-stats" 2>&1)
check "fourteen runs are counted"     "14"   "$(awk '/^stub /{print $2}' <<<"$out")"
check "and the clean share is read"   "100%" "$(awk '/^stub /{print $3}' <<<"$out")"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
