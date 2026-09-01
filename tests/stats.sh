#!/usr/bin/env bash
# libexec/lm-stats over a log written by hand. The reader calls no model and keeps
# no state, so the log is its whole input and a case here is a log and a reading.
# What these cover is the clean column's own reading, the two axes every record
# carries that the table never reads - the clean column split at a date and which
# caller the run came from - and the one thing the reader takes from outside the
# log: whether the registry holds the name a record carries.

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
     head_moved:false, workflow:null, which:null,
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
  # The registry lm-stats reads is the operator's if the case does not say, and a
  # case that asks whether a name was checked would then read their tools/.
  unset LM_TOOLS
}
teardown() { cd /; rm -rf "$work"; }

# Only the names in it are read, so a tool file needs no contents to be one.
tools() { # name...
  local n
  mkdir -p "$work/tools"
  for n in "$@"; do : > "$work/tools/$n.sh"; done
}

# rec writes every record under one name, and a case about the registry is about
# which name.
named() { # ts clean repo verb n
  local i
  for ((i = 0; i < $5; i++)); do rec "$1" "$2" "$3" | jq -c --arg v "$4" '.verb = $v' >> "$LM_LOG"; done
}

# One record that ended at a given code. The outcome columns count the exit and
# not the answer, so what varies here is the code alone.
ended() { # ts repo exit
  rec "$1" true "$2" | jq -c --argjson e "$3" '.exit = $e' >> "$LM_LOG"
}

# n clean runs and n-clean retried ones, all at one timestamp.
period() { # ts total clean
  local i
  for ((i = 0; i < $3; i++)); do rec "$1" true  "$REPO" >> "$LM_LOG"; done
  for ((i = $3; i < $2; i++)); do rec "$1" false "$REPO" >> "$LM_LOG"; done
}

# before n since n, read out of the split block alone: the verb's own row appears
# in the table above it too. The whole row after the verb is normalised rather
# than read by field, because a clean cell is one word or three.
row() { sed -n '/^first answer clean/,/^$/p' \
  | awk '/^stub /{ $1 = ""; sub(/^ +/, ""); print }'; }

# The clean cell of the table above, which is either the withheld sample or the
# share with its bound.
clean() { sed -n 's/^stub  *[0-9][0-9]*  *\(n<14\|[0-9]*% \xe2\x89\xa4[0-9]*%\).*/\1/p'; }

# The verb column of each table, in the order it is printed: which rows exist is
# the whole question a registry check answers.
verbs() { awk 'NR == 1 { next } /^$/ { exit } { print $1 }' | paste -sd' ' -; }
split_verbs() { sed -n '/^first answer clean/,/^$/p' \
  | awk 'NR <= 2 { next } NF == 0 { exit } { print $1 }' | paste -sd' ' -; }
runs() { awk -v n="$1" '$1 == n { print $2; exit }'; }
collapsed() { sed -n '/counted as (unknown):/{n;s/^ *//;p;}'; }

BEFORE=2026-08-25T09:00:00+02:00
SINCE=2026-08-27T09:00:00+02:00
CUT=2026-08-26

# The clean column is the one figure read against a threshold, and a share cannot
# say whether the sample it came from excludes that threshold. The cell carries
# the one-sided 95% upper bound beside the share, so the reading is on the screen
# rather than in a calculation nobody runs.
setup
period "$BEFORE" 14 11
check "a share above the minimum carries its bound" "78% ≤91%" "$("$STATS" 2>&1 | clean)"
teardown

# The pair is worth printing because its halves can disagree: eleven of fourteen
# sits below four in five and leaves it standing, while twenty of thirty puts it
# away. A column printing the share alone reads the same in both.
setup
period "$BEFORE" 30 20
check "and a sample that excludes the threshold says so" "66% ≤79%" "$("$STATS" 2>&1 | clean)"
teardown

# Under the minimum there is no share to bound, and the withheld sample is the
# whole cell.
setup
period "$BEFORE" 13 13
check "under the minimum the cell withholds both" "n<14" "$("$STATS" 2>&1 | clean)"
teardown

# A verb nothing has been edited on is the case the bound exists for: the share
# is perfect and the sample still admits every threshold there is.
setup
period "$BEFORE" 14 14
check "a perfect share at the minimum bounds nothing away" "100% ≤100%" "$("$STATS" 2>&1 | clean)"
teardown

# 8 is the one non-zero code that leaves work standing in the repository, so the
# table counts it apart from the codes that leave the tree as they found it. A
# partial delivery folded into `failed` is one the operator is not told he has.
setup
ended "$BEFORE" "$REPO" 0
ended "$BEFORE" "$REPO" 1
ended "$BEFORE" "$REPO" 7
ended "$BEFORE" "$REPO" 8
out=$("$STATS" 2>&1)
check "a partial delivery is counted apart from a failure" "4 1 0 1 1" \
  "$(awk '/^stub /{print $2, $4, $5, $6, $7}' <<<"$out")"
check "and the column has a name of its own" "1" "$(awk 'NR == 1 && /partial/{print 1}' <<<"$out")"
teardown

# A column that disappears when nothing landed in it reads as a feature nobody
# built, so the zero is printed.
setup
ended "$BEFORE" "$REPO" 1
check "a log with no partial run prints the column as a zero" "1 0 1 0" \
  "$("$STATS" 2>&1 | awk '/^stub /{print $2, $5, $6, $7}')"
teardown

# The question the table cannot answer: how the clean share moved between two
# dates. Both periods here carry the sample the column needs, so both are read.
setup
period "$BEFORE" 15 12
period "$SINCE"  15 9
out=$("$STATS" --since "$CUT" 2>&1)
check "the split names its date"      "1" "$(grep -c "split at $CUT" <<<"$out")"
check "and reads both periods"        "80% ≤92% 15 60% ≤78% 15" "$(row <<<"$out")"
check "the table still reads the heap" "70% ≤82%" "$(clean <<<"$out" | head -1)"
teardown

# The same fifteen-and-fifteen with one record's ts moved across the cut. Both
# shares move, and a reader that ignored ts would print the pair above.
setup
period "$BEFORE" 14 11
period "$SINCE"  16 10
check "moving one run moves both shares" "78% ≤91% 14 62% ≤79% 16" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# A period reads its own share against its own sample, so one side can be read
# while the other withholds itself. Thirteen is the last count that cannot be.
setup
period "$BEFORE" 13 13
period "$SINCE"  14 14
check "a period under the minimum withholds" "n<14 13 100% ≤100% 14" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# A period with nothing in it is the same case as a period below the minimum, and
# it is the one that would divide by zero if the minimum were not read first.
setup
period "$SINCE" 14 14
check "an empty period is withheld, not divided" "n<14 0 100% ≤100% 14" "$("$STATS" --since "$CUT" 2>&1 | row)"
teardown

# One log spans every repository, so the split counts the tree it runs in. A run
# from elsewhere belongs to neither period.
setup
period "$BEFORE" 14 14
rec "$SINCE" true other >> "$LM_LOG"
check "another repository is out of both periods" "100% ≤100% 14 n<14 0" "$("$STATS" --since "$CUT" 2>&1 | row)"
check "and --all takes it in"                     "100% ≤100% 14 n<14 1" "$("$STATS" --all --since "$CUT" 2>&1 | row)"
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
check "and the share is read over all of it"                       "100% ≤100%" "$(clean <<<"$out")"
teardown

# The block that reads that axis, over a log holding all three shapes at once: a
# run the chat ran, a run typed at the command line, and a run written before the
# field, which names neither and so answers neither number.
callers() { # ts caller repo n
  local i
  for ((i = 0; i < $4; i++)); do rec "$1" true "$3" | jq -c --arg c "$2" '. + {caller:$c}' >> "$LM_LOG"; done
}
# the two counts, read out of the caller block alone.
chatrun() { sed -n '/^runs from the chat/{n;s/^ *//;p;}'; }

setup
callers "$BEFORE" chat "$REPO" 4
callers "$BEFORE" cli  "$REPO" 6
period  "$BEFORE" 9 9
out=$("$STATS" 2>&1)
check "the chat's runs are read over the runs that name a caller" "4 of 10" "$(chatrun <<<"$out")"
check "and the block says what its denominator counts" \
  "1" "$(grep -c '^runs from the chat, of the runs that name a caller:$' <<<"$out")"
check "the window leaves the block whole, as it leaves its neighbours" \
  "4 of 10" "$("$STATS" --since "$CUT" 2>&1 | chatrun)"
teardown

# A log older than the field cannot answer, and says so with a denominator of none
# rather than reading those runs as the command line's.
setup
period "$BEFORE" 9 9
check "a log written before the field is in neither number" "0 of 0" "$("$STATS" 2>&1 | chatrun)"
teardown

# And a log written entirely after it has nothing to withhold, which is the case
# that says the denominator narrows only where a record is silent.
setup
callers "$BEFORE" chat "$REPO" 3
callers "$BEFORE" cli  "$REPO" 2
check "a log where every run names a caller counts all of them" "3 of 5" "$("$STATS" 2>&1 | chatrun)"
teardown

# One log spans every repository, so the block counts the tree it runs in.
setup
callers "$BEFORE" chat "$REPO" 2
callers "$BEFORE" cli  "$REPO" 2
callers "$BEFORE" chat other   1
callers "$BEFORE" cli  other   2
check "another repository is out of the block" "2 of 4" "$("$STATS" 2>&1 | chatrun)"
check "and --all takes that repository in"     "3 of 7" "$("$STATS" --all 2>&1 | chatrun)"
teardown

# The field that names the workflow a run belonged to was called `composition`
# before it was called `workflow`, so a real log holds both names and a run under
# either counts once. A record under neither belonged to no workflow.
flowrun() { sed -n '/^runs from a workflow/{n;s/^ *//;p;}'; }

setup
rec "$BEFORE" true "$REPO" | jq -c '. + {workflow:"ship-1"}'                  >> "$LM_LOG"
rec "$BEFORE" true "$REPO" | jq -c 'del(.workflow) + {composition:"ship-2"}'  >> "$LM_LOG"
rec "$BEFORE" true "$REPO"                                                    >> "$LM_LOG"
out=$("$STATS" 2>&1)
check "a run under either name counts as a workflow's" "2 of 3" "$(flowrun <<<"$out")"
check "and the block is named for the kind"            "1" "$(grep -c '^runs from a workflow:$' <<<"$out")"
teardown

# An emptied LM_LOG turns logging off, so there is no log to read and no period to
# report. The refusal comes before the arguments are parsed.
setup
out=$(LM_LOG='' "$STATS" --since "$CUT" 2>&1); rc=$?
check "an empty LM_LOG is refused"    "2" "$rc"
check "and named as empty, not as a path" "1" "$(grep -c 'LM_LOG is empty' <<<"$out")"
teardown

# The log carries a name, and only the registry says whether that name is a verb
# of this project. What it holds keeps its own row, and everything else is one row
# rather than none: a run that vanished off the table is a run the reader is not
# told about.
setup
tools changelog commit
named "$BEFORE" true "$REPO" commit    3
named "$BEFORE" true "$REPO" changelog 2
named "$BEFORE" true "$REPO" accepts   2
named "$BEFORE" true "$REPO" rejects   4
out=$("$STATS" 2>&1)
check "what the registry holds keeps its own row" "changelog commit (unknown)" "$(verbs <<<"$out")"
check "and the collapsed row carries every run it took" "6" "$(runs '(unknown)' <<<"$out")"
check "and the names it took are printed rather than dropped" \
  "accepts, rejects" "$(collapsed <<<"$out")"
check "and the registry it was read against is named" \
  "1" "$(grep -c "^names $work/tools does not hold, counted as (unknown):\$" <<<"$out")"
teardown

# The same log with nothing to check it against. A reader that could not look must
# not report every name as one nobody has, so it collapses nothing and says why.
setup
named "$BEFORE" true "$REPO" commit  3
named "$BEFORE" true "$REPO" accepts 2
out=$("$STATS" 2>&1)
check "with no registry every name keeps its row" "accepts commit" "$(verbs <<<"$out")"
check "and the reader says it could not look" \
  "1" "$(grep -c '^no registry, so no verb name was checked against one:$' <<<"$out")"
check "and says which of the two ways it could not" \
  "1" "$(grep -c '^  no tools/ in the tree you are in, and LM_TOOLS names none$' <<<"$out")"
teardown

# A registry named and not there is the other way, and it is not a registry holding
# nothing: the path is named back because it is the thing to fix.
setup
tools commit
named "$BEFORE" true "$REPO" commit 3
out=$(LM_TOOLS=$work/gone "$STATS" 2>&1)
check "a registry that is not a directory is not one that holds nothing" \
  "commit" "$(verbs <<<"$out")"
check "and the path is named back" \
  "1" "$(grep -c "^  LM_TOOLS names $work/gone, which is not a directory\$" <<<"$out")"
teardown

# LM_TOOLS is the registry when it names one, as it is for a verb: the tools/ of
# the tree you are standing in loses to it rather than joining it.
setup
tools commit
mkdir "$work/elsewhere"; : > "$work/elsewhere/accepts.sh"
named "$BEFORE" true "$REPO" commit  3
named "$BEFORE" true "$REPO" accepts 2
check "LM_TOOLS is the registry, not the tree's own tools/" \
  "accepts (unknown)" "$(LM_TOOLS=$work/elsewhere "$STATS" 2>&1 | verbs)"
check "and without it the tree's own tools/ is" \
  "commit (unknown)" "$("$STATS" 2>&1 | verbs)"
teardown

# The registry holds verbs and workflows, and the table asks only whether it holds
# the name. A file that declares itself a workflow is a name it holds like any
# other, so nothing here sources a tool file to find out.
setup
tools ship
printf 'name="ship"\ndescription="d"\nverbs="commit pr"\n' > "$work/tools/ship.sh"
named "$BEFORE" true "$REPO" ship 3
check "a file declaring itself a workflow is a name the registry holds" \
  "ship" "$("$STATS" 2>&1 | verbs)"
teardown

# --all reads repositories this registry does not answer for, so the screen says so
# rather than filing another project's verb under a fixture's row in silence.
setup
tools commit
named "$BEFORE" true "$REPO" commit  3
named "$BEFORE" true "$REPO" accepts 2
check "--all says another project's verb is not in this registry" \
  "1" "$(grep -c "another project's verb" <<<"$("$STATS" --all 2>&1)")"
check "and one repository's own table does not" \
  "0" "$(grep -c "another project's verb" <<<"$("$STATS" 2>&1)")"
teardown

# The split is a verb table too, so a name the table collapses cannot reappear
# under it.
setup
tools commit
named "$BEFORE" true "$REPO" commit  3
named "$BEFORE" true "$REPO" accepts 2
named "$SINCE"  true "$REPO" accepts 1
check "the split collapses the names the table above it collapsed" \
  "commit (unknown)" "$("$STATS" --since "$CUT" 2>&1 | split_verbs)"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
