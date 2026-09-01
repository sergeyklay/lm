#!/usr/bin/env bash
# Exercises the two halves of tools/changelog.sh no fixture repository can reach:
# _insert() against the fixtures next door, and validate()'s judgement of an
# internal symbol from a copy of the tool sitting outside the installation.
# No model call: both are deterministic, so both are checked byte for byte.
#
# An _insert case is a pair of files in fixtures/:
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

# validate() judges a bullet's back-quoted words against lm's own tree: a function
# docs/tools.md publishes is a name the user has, and every other one is not. The
# tree is the runner's answer, so a copy of this tool in some other project's
# tools/ has to reach the installation and not the project it was copied into.
# Driven the way a runner drives it, over one bullet per name the contract
# publishes and one naming a private helper.
check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

INSTALL=$(dirname "$ROOT")
copy=$(mktemp -d); mkdir -p "$copy/tools"
cp "$ROOT/../tools/changelog.sh" "$copy/tools/changelog.sh"

accused() { # $1 tool file -> the names it reported, in order
  local tok entry out
  for tok in collect schema validate render apply name _insert; do
    entry=$(jq -nc --arg t "$tok" '{entries:[{category:"Added",bullet:("A way to run `\($t)` from the shell")}]}')
    out=$(LM_INSTALL="$INSTALL" bash -c '. "$1" || exit 1; validate' bash "$1" <<<"$entry")
    case "$out" in *"names '$tok'"*) printf '%s ' "$tok" ;; esac
  done
}

here=$(accused "$ROOT/../tools/changelog.sh")
there=$(accused "$copy/tools/changelog.sh")
rm -rf "$copy"

check "the installation accuses the private helper and nothing else" "_insert " "$here"
check "and a copy in another project's tools/ accuses exactly the same" "_insert " "$there"
check "so the two verdicts are one verdict" "$here" "$there"

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
