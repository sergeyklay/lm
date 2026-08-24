name="issue"
description="Draft and create a GitHub issue, picking labels from the repository taxonomy"

_get_labels() {
  # Determine cache file location inside the .git directory
  local git_dir cache_file fetch
  git_dir=$(git rev-parse --git-dir 2>/dev/null) || return 1
  cache_file="$git_dir/lm_labels_cache.txt"

  fetch=0
  # Check if cache is missing or older than 24 hours (1440 minutes)
  if [ ! -f "$cache_file" ]; then
    fetch=1
  elif [ -n "$(find "$cache_file" -mmin +1440 2>/dev/null)" ]; then
    fetch=1
  fi

  if (( fetch )); then
    # Fetch labels using gh cli and atomically save to cache
    gh label list --limit 100 --json name -q '.[].name' > "$cache_file.tmp" 2>/dev/null && mv -f "$cache_file.tmp" "$cache_file" || true
  fi

  if [ -f "$cache_file" ] && [ -s "$cache_file" ]; then
    cat "$cache_file"
  else
    # Fallback if gh fails or user is offline
    echo 'bug'
    echo 'enhancement'
    echo 'documentation'
  fi
}

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  if ! command -v gh >/dev/null 2>&1; then echo "lm: gh cli is required" >&2; return 3; fi

  local diff topic
  diff=$(git diff --cached 2>/dev/null)

  # Interactive prompt for issue intent if the diff is empty
  # Prompts go to stderr, reads from /dev/tty so stdout remains clean for the runner
  if [ -z "$diff" ]; then
     read -r -p "lm: Nothing staged. Issue topic or bug summary: " topic </dev/tty >&2
     [ -z "$topic" ] && { echo "lm: empty topic, aborting" >&2; return 3; }
     printf '%s\n' \
       "User provided issue topic:" "$topic" "" \
       "Write a GitHub issue for this topic."
  else
     printf '%s\n' \
       "Staged changes to be reported as an issue:" "$(printf '%s' "$diff" | head -c 40000)" "" \
       "Write a GitHub issue describing the problem or feature these changes address."
  fi

  printf '%s\n' \
    "Title: concise and descriptive." \
    "Body: detailed description, context, and motivation. Do NOT use hard line wraps in prose."
}

schema() {
  # The label enum is built exactly at call time
  local labels_json
  labels_json=$(_get_labels | jq -R . | jq -sc .)

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

  if grep -qP '(?<!\n)\n(?!\n|-|\*|\d+\.)' <<<"$bo"; then
    echo "body contains prohibited hard line wraps in prose"
  fi

  return 0
}

render() {
  local j ti bo labs
  j=$(cat)
  ti=$(jq -r '.title' <<<"$j")
  bo=$(jq -r '.body' <<<"$j")
  labs=$(jq -r '.labels[]?' <<<"$j" | paste -sd, -)

  echo "# $ti"
  [ -n "$labs" ] && echo "Labels: $labs"
  echo ""
  echo "$bo"
}

apply() {
  local j ti bo a
  j=$(cat)
  read -r -p "Create issue? [y/N] " a
  [ "$a" = y ] || exit 0

  ti=$(jq -r '.title' <<<"$j")
  bo=$(jq -r '.body' <<<"$j")

  local label_args=()
  while read -r l; do
    [ -n "$l" ] && label_args+=(--label "$l")
  done < <(jq -r '.labels[]?' <<<"$j")

  gh issue create --title "$ti" --body "$bo" "${label_args[@]}"
}
