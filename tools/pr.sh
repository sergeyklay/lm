name="pr"
description="Generate a pull request description from git log <default>..HEAD"

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }

  # Determine the default branch dynamically or fallback to main
  local default_branch diff log
  default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  [ -z "$default_branch" ] && default_branch="main"

  log=$(git log "${default_branch}..HEAD" --format='- %s%n%b' 2>/dev/null || true)
  [ -z "$log" ] && { echo "lm: no commits found against ${default_branch}" >&2; return 3; }

  diff=$(git diff "${default_branch}..HEAD" 2>/dev/null || true)

  printf '%s\n' \
    "Commits in this PR:" "$log" "" \
    "Staged diff:" "$(printf '%s' "$diff" | head -c 40000)" "" \
    "Write the pull request description for these changes." \
    "Title: concise and descriptive." \
    "Body: detailed summary of the changes. Do NOT use hard line wraps in prose."
}

schema() {
  jq -n -c '{
    type:"object",
    properties:{
      title:{type:"string",maxLength:80},
      body:{type:"string"}
    },
    required:["title","body"]
  }'
}

validate() {
  local j ti bo
  j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }

  ti=$(jq -r '.title // ""' <<<"$j")
  bo=$(jq -r '.body // ""' <<<"$j")

  [ -z "$ti" ] && echo "title is empty"
  [ -z "$bo" ] && echo "body is empty"

  # Rule: no hard line wraps in prose. A blank line and a list item are legal,
  # so the check needs the whole text: grep is line-oriented and can never
  # match a '\n' written in its pattern.
  if printf '%s\n' "$bo" | awk '
      NR > 1 && p != "" && $0 != "" && $0 !~ /^[[:space:]]*([-*]|[0-9]+\.)/ { f = 1 }
      { p = $0 } END { exit !f }'; then
    echo "body contains a hard line wrap in prose; write each paragraph as one unwrapped line"
  fi

  LC_ALL=C grep -qP '[^\x00-\x7F]' <<<"$j" && echo "output contains non-ASCII characters"

  return 0
}

render() {
  local j
  j=$(cat)
  printf '# %s\n\n%s\n' "$(jq -r '.title' <<<"$j")" "$(jq -r '.body' <<<"$j")"
}

apply() {
  local j a
  j=$(cat)
  read -r -p "Create PR? [y/N] " a </dev/tty
  [ "$a" = y ] || exit 0

  # Delegate to GitHub CLI for the actual side-effect
  gh pr create --title "$(jq -r '.title' <<<"$j")" --body "$(jq -r '.body' <<<"$j")"
}
