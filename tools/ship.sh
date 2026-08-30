name="ship"
description="Commit the working tree and open a pull request"
verbs="commit pr"
flags="--here --no-stage"

# <type>/<kebab-description>, from the subject the model just wrote. Four words is
# where a branch name stops being read and starts being scrolled past.
#
# Reading the subject back out of the commit looks like the long way round, and
# the short way is worse: naming the branch before committing means a --dry-run
# of `lm commit` first, which costs a second model call for a prompt identical to
# the first, because collect() in tools/commit.sh reads the working tree and
# `git log` and never the branch. Two calls, one answer.
_name() {
  local s t d
  s=$(git log -1 --format='%s')
  t=${s%%:*}; t=${t%%(*}
  d=$(printf '%s' "${s#*: }" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' \
      | sed 's/^-//;s/-$//' | cut -d- -f1-4 \
      | sed -E 's/-(a|an|the|to|of|in|on|for|from|with|and|when|that|its)$//')
  printf '%s/%s' "${t:-chore}" "${d:-change}"
}

# Every function here is its own bash process, so $$ differs in each and the run's
# own tag is what names the branch instead.
_branch() { printf 'lm-%s' "${LM_WORKFLOW:-ship}"; }

# The operator should not have to decide which branch they are on, so a thematic
# one is what happens when nothing is said. Its name is unknown until the commit
# exists, so it opens under a placeholder and is renamed once the subject is there.
prepare() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  if [ -z "${LM_HERE:-}" ]; then git switch -q -c "$(_branch)"; fi
}

# A refusal leaves neither a branch nor a commit. Nothing was committed, so HEAD
# has moved exactly once — into the placeholder — and the branch the operator
# started on is what the previous reflog entry names.
#
# `commit` exits 8 having landed part of the work, and those commits are on the
# placeholder. Deleting it then destroys exactly what 8 exists to say survived,
# so the branch goes only when it still points where the operator left it.
failed_commit() {
  if [ -z "${LM_HERE:-}" ]; then
    local b; b=$(_branch)
    git switch -q -
    if [ "$(git rev-parse -q --verify "$b")" = "$(git rev-parse HEAD)" ]; then
      git branch -q -D "$b"
    else
      echo "lm: commits landed on $b; leaving the branch in place" >&2
    fi
  fi
}

after_commit() {
  if [ -z "${LM_HERE:-}" ]; then
    local n
    n=$(_name)
    git branch -q -m "$n" 2>/dev/null || git branch -q -m "$n-$(git rev-parse --short HEAD)"
    echo "lm: on $(git branch --show-current)" >&2
  fi
}
