name="pr"
description="Generate a pull request description from git log <default>..HEAD"

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

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }

  local default_branch diff log secs tpl
  default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  [ -z "$default_branch" ] && default_branch="main"

  log=$(git log "${default_branch}..HEAD" --format='- %s%n%b' 2>/dev/null || true)
  [ -z "$log" ] && { echo "lm: no commits found against ${default_branch}" >&2; return 3; }

  diff=$(git diff "${default_branch}...HEAD" 2>/dev/null || true)

  printf '%s\n' \
    "Commits in this PR:" "$log" "" \
    "Diff against ${default_branch}:" "$(printf '%s' "$diff" | head -c 40000)" "" \
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
  confirm "Create PR? [y/N]"

  git push -u origin HEAD
  gh pr create --title "$(jq -r '.title' <<<"$j")" --body "$(_render_body "$j")"
}
