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
# the first, because collect() in tools/commit.sh reads the index, the working
# tree and `git log` and never the branch. Two calls, one answer.
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
#
# The operator should not have to stage what they are already shipping either. The
# verb cannot do it for them: collect() in tools/commit.sh reads the index and
# refuses an empty one, which is right, because it cannot describe a change it is
# not committing. So the opinion lives here and --no-stage takes it back off.
# git add sees more of the tree than reading it does: a modified file shows in git
# diff and in git add, an untracked one only in git add, and .gitignore is honoured
# either way. Staging survives a refusal, the way it already did when the operator
# typed it.
prepare() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  if [ -z "${LM_HERE:-}" ]; then git switch -q -c "$(_branch)"; fi
  if [ -z "${LM_NO_STAGE:-}" ]; then
    if git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
      # Having staged nothing is the surprising case, so it is the one that speaks.
      echo "lm: nothing to stage; shipping the index as it stands" >&2
    else
      git add -A
    fi
  fi
}

# A refusal leaves neither a branch nor a commit. Nothing was committed, so HEAD
# has moved exactly once — into the placeholder — and the branch the operator
# started on is what the previous reflog entry names.
failed_commit() {
  if [ -z "${LM_HERE:-}" ]; then
    git switch -q -
    git branch -q -D "$(_branch)"
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
