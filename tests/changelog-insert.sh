#!/usr/bin/env bash
# Exercises _insert() from tools/changelog.sh against the fixtures next door.
# No model call: the insertion is deterministic, so it is checked byte for byte.
#
# A case is a pair of files in fixtures/:
#   <name>.in.md              the changelog before the edit
#   <name>.<Category>.out.md  the changelog after it, and the category to insert
#
# Two things are asserted per case: the whole file matches the expected output,
# and every line from the first released heading onwards is untouched.

set -uo pipefail

ROOT=$(dirname "$(readlink -f "$0")")
BULLET="Support for drafting changelog entries from the staged diff"

# shellcheck source=../tools/changelog.sh
. "$ROOT/../tools/changelog.sh"

released() { awk '/^## \[Unreleased\]/{u=1; next} u && /^## \[/{p=1} p' "$1"; }

fail=0
for want in "$ROOT"/fixtures/*.out.md; do
  base=$(basename "$want" .out.md)     # <name>.<Category>
  name=${base%.*}
  catg=${base##*.}
  in="$ROOT/fixtures/$name.in.md"

  got=$(_insert "$catg" "$BULLET" < "$in")

  if ! diff -u --label "expected" "$want" --label "actual" <(printf '%s\n' "$got") > /tmp/lm-clt.diff; then
    echo "FAIL $name ($catg): output differs"
    sed 's/^/    /' /tmp/lm-clt.diff
    fail=1
    continue
  fi

  if ! diff -q <(released "$in") <(printf '%s\n' "$got" | released /dev/stdin) >/dev/null; then
    echo "FAIL $name ($catg): a released section was modified"
    fail=1
    continue
  fi

  echo "ok   $name ($catg)"
done

rm -f /tmp/lm-clt.diff
[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
