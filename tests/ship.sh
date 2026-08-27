#!/usr/bin/env bash
# The composition in libexec/lm-ship, with the two verbs stubbed out. lm-ship makes no
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
  cp "$ROOT/libexec/lm-ship" "$bin/lm-ship"
  COMPLOG=$(mktemp); export COMPLOG
  ARGLOG=$(mktemp); export ARGLOG
  cat > "$bin/lm-verb" <<EOF
#!/usr/bin/env bash
echo "\$1 \${LM_COMPOSITION:-none}" >> "\$COMPLOG"
echo "\$1 yes=\${LM_YES:-unset} args=\$*" >> "\$ARGLOG"
case "\$1" in
  commit) [ "${1:-0}" -eq 0 ] || exit ${1:-0}
          git commit -qm "feat: scope the widget to one repository" ;;
  pr)     echo "PR opened" ;;
esac
EOF
  chmod +x "$bin/lm-verb"
  cd "$work" || exit 1
  git init -q -b main .; git config user.email t@t; git config user.name t
  echo seed > f.txt; git add .; git commit -qm "chore: seed"
  echo change > f.txt; git add f.txt
}

teardown() { cd /; rm -rf "$work" "$COMPLOG" "$ARGLOG"; }

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

# An unstaged tree ships without a git add. g.txt is untracked on purpose: git diff
# never reports one and git add takes it, which is the difference the composition
# rests on. Silence is the assertion too: staging is the expected case now.
setup 0
git reset -q
echo more > g.txt
out=$("$bin/lm-ship" 2>&1)
check "the unstaged change was shipped" "f.txt,g.txt" "$(git show --name-only --format= HEAD | paste -sd,)"
check "and staging said nothing"        "0" "$(grep -c 'nothing to stage' <<<"$out")"
teardown

# --no-stage gets today's behaviour back: nothing is staged, and the verb's own
# refusal passes through untouched.
setup 3
git reset -q
"$bin/lm-ship" --no-stage >/dev/null 2>&1; rc=$?
check "--no-stage passes the refusal through" "3" "$rc"
check "--no-stage staged nothing"             ""  "$(git diff --cached --name-only)"
teardown

# Nothing to stage is the surprising case, so that is the one that speaks.
setup 3
git reset -q --hard
out=$("$bin/lm-ship" 2>&1)
check "a clean tree is named" "1" "$(grep -c 'nothing to stage' <<<"$out")"
teardown

# Both verbs of one composition carry the same name, and it is not empty. The log
# cannot tell a composed run from a typed one without it: lm writes one record per
# verb, so lm-ship leaves two that look like two the operator typed.
setup 0
"$bin/lm-ship" >/dev/null 2>&1
check "both verbs saw a composition" "2" "$(grep -cv ' none$' "$COMPLOG")"
check "and it was the same one"      "1" "$(cut -d' ' -f2 "$COMPLOG" | sort -u | wc -l)"
teardown

# Consent belongs to the composition. A verb takes it as a flag, and both verbs here
# are run by the script rather than typed, so the flag is consumed and the variable is
# what reaches them - a --yes forwarded as an argument is a flag the shell runner
# refuses, which is what the operator met.
setup 0
"$bin/lm-ship" --yes >/dev/null 2>&1
check "--yes reaches both verbs as the variable" "2" "$(grep -c 'yes=1' "$ARGLOG")"
check "and is not passed on as a flag"           "0" "$(grep -c -- '--yes' "$ARGLOG")"
check "and the commit still lands"               "feat: scope the widget to one repository" "$(git log -1 --format='%s')"
teardown

setup 0
"$bin/lm-ship" >/dev/null 2>&1
check "without it the verbs are asked as before" "2" "$(grep -c 'yes=unset' "$ARGLOG")"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
