#!/usr/bin/env bash
# bin/lm with curl stubbed. What the tools cannot pin: dispatch, the single
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
lm() { "$ROOT/bin/lm" "$@"; }
# script owns the terminal it lends to confirm, and echoes back through it.
tty_lm() { local a=$1; shift; script -qec "$ROOT/bin/lm $*" /dev/null <<<"$a" | tr -d '\r'; }

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

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
