name="pr"
description="Push the branch and create a pull request describing the commits ahead of the default branch"

# slug<TAB>heading for the shallowest heading level of the PR template, in file
# order. Empty when the repository has no template, which selects the plain
# {title, body} shape everywhere below.
_sections() {
  local f
  for f in .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md; do
    [ -f "$f" ] || continue
    awk '/^#+ / { d = length($1); if (!m || d < m) m = d; n++; lv[n] = d; ln[n] = $0 }
      END { for (i = 1; i <= n; i++) if (lv[i] == m) {
              h = ln[i]; s = h; sub(/^#+ +/, "", s); s = tolower(s)
              gsub(/[^a-z0-9]+/, "_", s); gsub(/^_+|_+$/, "", s)
              if (s != "") print s "\t" h } }' "$f"
    return 0
  done
}

# $1 model JSON -> the pull request body. Headings come from the template, never
# from the model: they carry emoji, and validate() rejects non-ASCII answers.
_render_body() {
  local secs slug head
  secs=$(_sections)
  [ -z "$secs" ] && { jq -r '.body' <<<"$1"; return 0; }
  while IFS=$'\t' read -r slug head; do
    printf '%s\n\n%s\n\n' "$head" "$(jq -r --arg k "$slug" '.sections[$k] // ""' <<<"$1")"
  done <<<"$secs"
}

# The branch a pull request would target, as a remote-tracking ref. Read-only
# by contract: collect() runs before the human has approved anything, so this
# must not reach for the network or write refs the way set-head --auto does.
#
# The walk below is not belt and braces. `git symbolic-ref refs/remotes/origin/HEAD`
# fails with "is not a symbolic ref" on any clone where `git remote set-head` has
# never run, which is most of them, so a lone lookup always falls through to
# whatever default sits behind it and every such repository silently gets that
# default as its base branch.
_base() {
  local b
  b=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null) && { echo "$b"; return 0; }
  for b in main master develop trunk; do
    git show-ref -q --verify "refs/remotes/origin/$b" && { echo "origin/$b"; return 0; }
  done
  echo "lm: cannot tell which branch a pull request would target." >&2
  echo "    Run 'git remote set-head origin --auto' once to record it." >&2
  return 1
}

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }

  local base diff log secs tpl
  base=$(_base) || return 3

  if [ "$(git branch --show-current)" = "${base#origin/}" ]; then
    echo "lm: on '${base#origin/}', which is what a pull request targets; branch first" >&2
    return 3
  fi

  log=$(git log "$base..HEAD" --format='- %s%n%b')
  [ -z "$log" ] && { echo "lm: no commits on this branch against $base; run 'lm commit' first" >&2; return 3; }

  # A stale $base is harmless on its own: the merge base does not move when the
  # default branch advances along a line this one never touched, so log and diff
  # come out identical either way. It misleads only once the branch already holds
  # commits the ref is behind by, and the local branch of the same name is what
  # knows that, for no network and no fetch on a read-only path.
  local b=${base#origin/} n all
  all=$(git rev-list --count "$base..HEAD")
  if n=$(git rev-list --count "$base..HEAD" "^$b" 2>/dev/null) && (( n < all )); then
    echo "lm: $base is behind '$b': $((all - n)) of these commits are already on '$b'." >&2
    echo "    Run 'git fetch' so the description covers this branch alone." >&2
  fi

  diff=$(git diff "$base...HEAD")

  printf '%s\n' \
    "Commits in this PR:" "$log" "" \
    "Diff against $base:" "$(printf '%s' "$diff" | head -c 40000)" "" \
    "Write the pull request description for these changes." \
    "Title: concise and descriptive." \
    "Body: detailed summary of the changes. Do NOT use hard line wraps in prose."

  secs=$(_sections)
  [ -z "$secs" ] && return 0
  tpl=$(cat .github/pull_request_template.md 2>/dev/null || cat .github/PULL_REQUEST_TEMPLATE.md)
  printf '%s\n' "" \
    "This repository has a pull request template. Fill one field per section." \
    "Write the content only: the headings are added for you, so do not repeat them." \
    "Replace every bracketed placeholder with a real value and keep the bold field labels." "" \
    "Template:" "$tpl"
}

schema() {   # section keys are built from the template at call time
  local secs
  secs=$(_sections)
  if [ -z "$secs" ]; then
    jq -n -c '{type:"object",
      properties:{title:{type:"string",maxLength:80},body:{type:"string"}},
      required:["title","body"]}'
  else
    cut -f1 <<<"$secs" | jq -R . | jq -sc . | jq -c '{
      type:"object",
      properties:{
        title:{type:"string",maxLength:80},
        sections:{type:"object",
          properties:(map({key:.,value:{type:"string"}})|from_entries),
          required:.}},
      required:["title","sections"]}'
  fi
}

validate() {
  local j ti bo
  j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }

  ti=$(jq -r '.title // ""' <<<"$j")
  bo=$(_render_body "$j")

  [ -z "$ti" ] && echo "title is empty"
  [ -z "${bo//[[:space:]]/}" ] && echo "body is empty"

  jq -r '.sections // {} | to_entries[] | select((.value | test("^\\s*$"))) | .key' <<<"$j" \
    | sed 's/^/section is empty: /'

  # Rule: no hard line wraps in prose. A blank line, a list item and a heading
  # are legal, and so is the line right after a heading, so the check needs the
  # whole text: grep is line-oriented and can never match a '\n' in its pattern.
  if printf '%s\n' "$bo" | awk '
      NR > 1 && p != "" && p !~ /^#/ && $0 != "" && $0 !~ /^[[:space:]]*(#|[-*]|[0-9]+\.)/ { f = 1 }
      { p = $0 } END { exit !f }'; then
    echo "body contains a hard line wrap in prose; write each paragraph as one unwrapped line"
  fi

  LC_ALL=C grep -qP '[^\x00-\x7F]' <<<"$j" && echo "output contains non-ASCII characters"

  return 0
}

render() {
  local j
  j=$(cat)
  printf '# %s\n\n%s\n' "$(jq -r '.title' <<<"$j")" "$(_render_body "$j")"
}

apply() {
  local j
  j=$(cat)
  confirm "Push the branch and create the PR? [y/N]"

  git push -u origin HEAD
  gh pr create --title "$(jq -r '.title' <<<"$j")" --body "$(_render_body "$j")"
}
