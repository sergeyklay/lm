#!/usr/bin/env bash
# libexec/lm-stats over a log written by hand. The reader calls no model and keeps
# no state, so the log is its whole input and a case here is a log and a reading.
# The clean column split at a date is what these cover: the axis every record
# carries, which the table itself never reads.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
STATS=$ROOT/libexec/lm-stats
fail=0

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

# One record, in the shape lm-stats reads: a clean run is one call that exited 0,
# and a retried one is the same run at two calls, which is what the column counts
# against it. Every other field is present because the reader reads it.
rec() { # ts clean repo
  jq -nc --arg ts "$1" --argjson clean "$2" --arg repo "$3" '
    {ts:$ts, repo:$repo, verb:"stub", model:"m", dry:false,
     calls:(if $clean then 1 else 2 end), violations:[], exit:0, ms:10,
     head_moved:false, composition:null, which:null,
     prompt_hash:null, answer_hash:null, answer_len:null,
     total_duration:null, load_duration:null, prompt_eval_count:null,
     prompt_eval_duration:null, eval_count:null, eval_duration:null}'
}

# The scope lm-stats reads is the basename of the tree it runs in, so the fixture
# repository names itself and a record from anywhere else is another repository.
setup() {
  work=$(mktemp -d); cd "$work" || exit 1
  git init -q -b main .
  REPO=$(basename "$work")
  LM_LOG=$work/log.jsonl; export LM_LOG; : > "$LM_LOG"
}
teardown() { cd /; rm -rf "$work"; }

# n clean runs and n-clean retried ones, all at one timestamp.
period() { # ts total clean
  local i
  for ((i = 0; i < $3; i++)); do rec "$1" true  "$REPO" >> "$LM_LOG"; done
  for ((i = $3; i < $2; i++)); do rec "$1" false "$REPO" >> "$LM_LOG"; done
}

# before n since n, read out of the split block alone: the verb's own row appears
# in the table above it too.
row() { sed -n '/^first answer clean/,/^$/p' | awk '/^stub /{print $2, $3, $4, $5}'; }

BEFORE=2026-08-25T09:00:00+02:00
SINCE=2026-08-27T09:00:00+02:00
CUT=2026-08-26

# The question the table cannot answer: how the clean share moved between two
# dates. Both periods here carry the sample the column needs, so both are read.
setup
period "$BEFORE" 15 12
period "$SINCE"  15 9
out=$("$STATS" --since "$CUT" 2>&1)
check "the split names its date"      "1" "$(grep -c "split at $CUT" <<<"$out")"
check "and reads both periods"        "80% 15 60% 15" "$(row <<<"$out")"
check "the table still reads the heap" "70%" "$(awk '/^stub /{print $3}' <<<"$out" | head -1)"
teardown

# The same fifteen-and-fifteen with one record's ts moved across the cut. Both
# shares move, and a reader that ignored ts would print the pair above.
setup
period "$BEFORE" 14 11
period "$SINCE"  16 10
check "moving one run moves both shares" "78% 14 62% 16" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# A period reads its own share against its own sample, so one side can be read
# while the other withholds itself. Thirteen is the last count that cannot be.
setup
period "$BEFORE" 13 13
period "$SINCE"  14 14
check "a period under the minimum withholds" "n<14 13 100% 14" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# A period with nothing in it is the same case as a period below the minimum, and
# it is the one that would divide by zero if the minimum were not read first.
setup
period "$SINCE" 14 14
check "an empty period is withheld, not divided" "n<14 0 100% 14" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# One log spans every repository, so the split counts the tree it runs in. A run
# from elsewhere belongs to neither period.
setup
period "$BEFORE" 14 14
rec "$SINCE" true other >> "$LM_LOG"
check "another repository is out of both periods" "100% 14 n<14 0" "$("$STATS" --since "$CUT" 2>&1 | row)"
check "and --all takes it in"                     "100% 14 n<14 1" "$("$STATS" --all --since "$CUT" 2>&1 | row)"
teardown

# A value that is not a date would split every run to one side and read as a
# period with nothing in it, which is an answer to a question nobody asked.
setup
period "$BEFORE" 14 14
out=$("$STATS" --since yesterday 2>&1); rc=$?
check "a value that is not a date exits 2" "2" "$rc"
check "and is named back"                  "1" "$(grep -c "not 'yesterday'" <<<"$out")"
out=$("$STATS" --since 2>&1); rc=$?
check "--since with no value exits 2"      "2" "$rc"
out=$("$STATS" --nope 2>&1); rc=$?
check "an unknown argument still exits 2"  "2" "$rc"
check "and the options are named"          "1" "$(grep -c -- '--all and --since' <<<"$out")"
teardown

# The record grew a caller after every field above it was settled, so a real log
# holds both shapes at once. The reader names neither, and a run written before the
# field has to count exactly as one written after it.
setup
period "$BEFORE" 8 8
for ((i = 0; i < 7; i++)); do rec "$SINCE" true "$REPO" | jq -c '. + {caller:"chat"}' >> "$LM_LOG"; done
out=$("$STATS" 2>&1)
check "a log written across the field's arrival is one population" "15" "$(awk '/^stub /{print $2}' <<<"$out")"
check "and the share is read over all of it"                       "100%" "$(awk '/^stub /{print $3}' <<<"$out")"
teardown

# An emptied LM_LOG turns logging off, so there is no log to read and no period to
# report. The refusal comes before the arguments are parsed.
setup
out=$(LM_LOG='' "$STATS" --since "$CUT" 2>&1); rc=$?
check "an empty LM_LOG is refused"    "2" "$rc"
check "and named as empty, not as a path" "1" "$(grep -c 'LM_LOG is empty' <<<"$out")"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
