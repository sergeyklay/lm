#!/usr/bin/env bash
# Replays the deterministic half of each verb against recorded fixtures.
#
# A verb is deterministic everywhere except the model call: collect() builds the
# prompt from the repository, schema() builds the answer's shape from it too,
# and validate() and render() are functions of the recorded answer alone. All
# four are pinned here, so an edit to one tool cannot quietly move another.
#
# A case is tests/golden/<verb>/<name>/ holding:
#   setup.sh      builds the fixture repository in an empty directory
#   answer.json   an answer of the shape schema() asks for
#   args          optional, one argument per line, handed to collect()
#   prompt.txt schema.json violations.txt render.txt   the expectations
#   stderr.txt    what collect() said to the human while building the prompt
#
#   bash tests/golden.sh            check
#   bash tests/golden.sh --update   rewrite the expectations, then read the diff

set -uo pipefail

ROOT=$(dirname "$(readlink -f "$0")")
export GOLDEN="$ROOT/golden"
UPDATE=0; [ "${1:-}" = "--update" ] && UPDATE=1

# The runner defines confirm() for the tools; apply() is never called here, but
# sourcing must not fail on a name the tool expects its runner to provide.
confirm() { :; }

fail=0
for setup in "$GOLDEN"/*/*/setup.sh; do
  case_dir=$(dirname "$setup")
  verb=$(basename "$(dirname "$case_dir")")
  name="$verb/$(basename "$case_dir")"
  tool="$ROOT/../tools/$verb.sh"

  work=$(mktemp -d)
  ( cd "$work" && . "$setup" ) >/dev/null 2>&1 || { echo "FAIL $name: setup failed"; fail=1; rm -rf "$work"; continue; }

  for part in prompt stderr schema violations render; do
    ext=txt; [ "$part" = schema ] && ext=json
    want="$case_dir/$part.$ext"
    got=$(
      cd "$work" || exit 1
      . "$tool"
      args=(); [ -f "$case_dir/args" ] && mapfile -t args < "$case_dir/args"
      case $part in
        prompt)     collect "${args[@]}" 2>/dev/null ;;
        stderr)     collect "${args[@]}" 2>&1 >/dev/null ;;
        schema)     schema | jq -S . ;;
        violations) validate < "$case_dir/answer.json" ;;
        render)     render   < "$case_dir/answer.json" ;;
      esac
    ) || { echo "FAIL $name/$part: the tool errored"; fail=1; continue; }

    if (( UPDATE )); then printf '%s\n' "$got" > "$want"; continue; fi

    if [ ! -f "$want" ]; then
      echo "FAIL $name/$part: no recorded expectation; run with --update"; fail=1; continue
    fi
    if ! diff -u --label "want" "$want" --label "got" <(printf '%s\n' "$got"); then
      echo "FAIL $name/$part"; fail=1; continue
    fi
    echo "ok   $name/$part"
  done
  rm -rf "$work"
done

(( UPDATE )) && { echo "expectations rewritten; read the diff before committing"; exit 0; }
[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
