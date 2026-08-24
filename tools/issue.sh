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
  echo ""
  echo "$bo"
  echo ""
}

apply() {
  local j ti bo a
  j=$(cat)

  ti=$(jq -r '.title' <<<"$j")
  bo=$(jq -r '.body' <<<"$j")

  # Interactive label selection using read
  local suggested_labels
  suggested_labels=$(jq -r '.labels[]?' <<<"$j" | paste -sd, - | sed 's/,/, /g')
  
  echo ""
  echo "---"
  echo ""
  local labels_input
  read -r -p "Labels (${suggested_labels:-none}): " labels_input </dev/tty

  local final_labels=()
  if [ -z "$labels_input" ]; then
    # Keep suggested labels
    while read -r l; do
      [ -n "$l" ] && final_labels+=("$l")
    done < <(jq -r '.labels[]?' <<<"$j")
  elif [ "$labels_input" != "none" ]; then
    # Parse comma-separated user input
    IFS=',' read -ra parsed_labels <<< "$labels_input"
    for l in "${parsed_labels[@]}"; do
      # Trim leading/trailing whitespace
      l=$(echo "$l" | xargs)
      [ -n "$l" ] && final_labels+=("$l")
    done
  fi

  echo ""
  read -r -p "Create issue? [y/N] " a </dev/tty
  [ "$a" = y ] || exit 0


  local label_args=()
  for l in "${final_labels[@]}"; do
    label_args+=(--label "$l")
  done

  gh issue create --title "$ti" --body "$bo" "${label_args[@]}"
}
