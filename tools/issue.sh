name="issue"
description="Draft and create a GitHub issue, picking labels from the repository taxonomy"

# The enum the model picks from, straight from the repository every run. No cache
# under .git: schema() runs before the human has approved anything, and a cache is
# a write. collect() and schema() each call it, in separate subshells, which costs
# one gh request against a model call that costs tens of seconds.
_labels() {
  gh label list --limit 100 --json name -q '.[].name' 2>/dev/null
}

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  command -v gh >/dev/null 2>&1 || { echo "lm: gh cli is required" >&2; return 3; }

  local diff topic="$*"
  diff=$(git diff --cached 2>/dev/null)

  if [ -z "$diff" ] && [ -z "$topic" ]; then
    echo "lm: nothing staged and no topic given." >&2
    echo "    Stage the change, or say what the issue is: lm issue \"...\"" >&2
    return 3
  fi

  # Without the label set there is no closed set to answer from, so the run ends
  # here rather than after a model call the schema could not constrain.
  if [ -z "$(_labels)" ]; then
    echo "lm: no labels readable in this repository; check 'gh auth status'" >&2
    return 3
  fi

  [ -n "$topic" ] && printf '%s\n' \
    "The person running this described the issue as follows:" "$topic" ""

  [ -n "$diff" ] && printf '%s\n' \
    "Staged changes to be reported as an issue:" "$(printf '%s' "$diff" | head -c 40000)" ""

  printf '%s\n' \
    "Write a GitHub issue for this." \
    "Title: concise and descriptive." \
    "Body: detailed description, context, and motivation. Do NOT use hard line wraps in prose."
}

schema() {
  local labels_json
  labels_json=$(_labels | jq -R . | jq -sc .)

  jq -n -c --argjson labs "$labels_json" '{
    type:"object",
    properties:{
      title:{type:"string",maxLength:80},
      body:{type:"string"},
      labels:{
        type:"array",
        items:{type:"string",enum:$labs}
      }
    },
    required:["title","body","labels"]
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

  return 0
}

render() {
  local j ti bo
  j=$(cat)
  ti=$(jq -r '.title' <<<"$j")
  bo=$(jq -r '.body' <<<"$j")

  echo "# $ti"
  echo ""
  echo "$bo"
  echo ""
}

apply() {
  local j ti bo
  j=$(cat)

  ti=$(jq -r '.title' <<<"$j")
  bo=$(jq -r '.body' <<<"$j")

  local suggested_labels
  suggested_labels=$(jq -r '.labels[]?' <<<"$j" | paste -sd, - | sed 's/,/, /g')

  echo ""
  echo "---"
  echo ""
  local labels_input
  labels_input=$(ask "Labels (${suggested_labels:-none}):")

  local final_labels=()
  if [ -z "$labels_input" ]; then
    while read -r l; do
      [ -n "$l" ] && final_labels+=("$l")
    done < <(jq -r '.labels[]?' <<<"$j")
  elif [ "$labels_input" != "none" ]; then
    IFS=',' read -ra parsed_labels <<< "$labels_input"
    for l in "${parsed_labels[@]}"; do
      l=$(echo "$l" | xargs)
      [ -n "$l" ] && final_labels+=("$l")
    done
  fi

  echo ""
  confirm "Create issue? [y/N]"

  local label_args=()
  for l in "${final_labels[@]}"; do
    label_args+=(--label "$l")
  done

  gh issue create --title "$ti" --body "$bo" "${label_args[@]}"
}
