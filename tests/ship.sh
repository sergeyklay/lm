#!/usr/bin/env bash
# The composition in bin/lm-ship, with the two verbs stubbed out. lm-ship makes no
# model call of its own, so all of it is testable: which branch the commit lands
# on, what that branch ends up named, and what a refusal leaves behind.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
fail=0

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

# $1 becomes the stub's exit code for `commit`; a stub that refuses makes no commit,
# which is what `lm commit` does when the human answers n.
setup() {
  work=$(mktemp -d); bin=$work/bin; mkdir -p "$bin"
  cp "$ROOT/bin/lm-ship" "$bin/lm-ship"
  cat > "$bin/lm" <<EOF
#!/usr/bin/env bash
case "\$1" in
  commit) [ "${1:-0}" -eq 0 ] || exit ${1:-0}
          git commit -qm "feat: scope the widget to one repository" ;;
  pr)     echo "PR opened" ;;
esac
EOF
  chmod +x "$bin/lm"
  cd "$work" || exit 1
  git init -q -b main .; git config user.email t@t; git config user.name t
  echo seed > f.txt; git add .; git commit -qm "chore: seed"
  echo change > f.txt; git add f.txt
}

teardown() { cd /; rm -rf "$work"; }

# A thematic branch is what happens when nothing is said, named from the subject.
setup 0
out=$("$bin/lm-ship" 2>&1)
check "branch is named from the subject" "feat/scope-the-widget" "$(git branch --show-current)"
check "the commit landed on it"          "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
check "pr ran"                           "PR opened" "$(grep -m1 'PR opened' <<<"$out")"
check "main is untouched"                "chore: seed" "$(git log -1 --format='%s' main)"
teardown

# --here commits where the operator already is.
setup 0
"$bin/lm-ship" --here >/dev/null 2>&1
check "--here stays on the branch"    "main" "$(git branch --show-current)"
check "--here still commits"          "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
check "--here leaves no other branch" "main" "$(git branch --format='%(refname:short)' | paste -sd,)"
teardown

# A refusal leaves neither a branch nor a commit.
setup 7
"$bin/lm-ship" >/dev/null 2>&1; rc=$?
check "the refusal is passed through" "7"    "$rc"
check "back on the original branch"   "main" "$(git branch --show-current)"
check "no branch left behind"         "main" "$(git branch --format='%(refname:short)' | paste -sd,)"
check "no commit made"                "chore: seed" "$(git log -1 --format='%s')"
check "the work is still staged"      "f.txt" "$(git diff --cached --name-only | paste -sd,)"
teardown

# The same refusal with --here, where there is no placeholder to clean up.
setup 7
"$bin/lm-ship" --here >/dev/null 2>&1; rc=$?
check "--here passes the refusal through" "7"    "$rc"
check "--here made no commit"             "chore: seed" "$(git log -1 --format='%s')"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
