name="commit"
description="Write a Conventional Commits message for the staged changes"

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  local br; br=$(git branch --show-current)
  case "$br" in main|master|develop|release/*|hotfix/*)
      echo "lm: refusing to work on protected branch '$br'" >&2; return 3 ;; esac
  local diff files style
  diff=$(git diff --cached); [ -n "$diff" ] || { echo "lm: nothing staged" >&2; return 3; }
  files=$(git diff --cached --name-only)
  style=$(git log --format='%s' -20 2>/dev/null || true)
  printf '%s\n' \
    "Recent commit subjects in this repository. Match their vocabulary and level of detail:" "$style" "" \
    "Files changed:" "$files" "" \
    "Staged diff:" "$(printf '%s' "$diff" | head -c 40000)" "" \
    "Write the commit message for this change." \
    "Subject: imperative mood, lower case after the colon, no trailing period, under 60 characters, no issue number." \
    "Body: two or three sentences saying what changed and why. No bullet lists, no file names, no phrases like 'This commit'."
}

schema() {   # the scope enum is built from the repository at call time
  local scopes
  scopes=$(git diff --cached --name-only | awk -F/ '{
      for (i=1;i<NF;i++){print $i; if(i+1<NF) print $i"/"$(i+1)}
      n=split($NF,a,"."); if(n>1) print a[1] }' \
    | sort -u | grep -vE '^(src|internal|pkg|cmd|lib|app|test|tests|docs?)$' | head -25)
  printf '%s\n' "$scopes" "" | jq -R . | jq -sc . | jq -c '{
    type:"object",
    properties:{
      type:{type:"string",enum:["feat","fix","docs","style","refactor","perf","test","chore","ci","build","revert"]},
      scope:{type:"string",enum:.},
      subject:{type:"string",maxLength:60},
      body:{type:"string"}},
    required:["type","subject","body"]}'
}

validate() {
  local j ty sc su bo line; j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }
  ty=$(jq -r '.type' <<<"$j"); sc=$(jq -r '.scope // ""' <<<"$j")
  su=$(jq -r '.subject' <<<"$j"); bo=$(jq -r '.body' <<<"$j")
  line=$([ -n "$sc" ] && echo "$ty($sc): $su" || echo "$ty: $su")
  [[ "$su" =~ ^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert): ]] && echo "subject repeats the type prefix"
  [[ "$su" =~ \.$ ]] && echo "subject ends with a period"
  [[ "$su" =~ ^[A-Z] ]] && echo "subject starts with a capital letter"
  (( ${#line} >= 72 )) && echo "header is ${#line} chars, must be under 72"
  [[ "$bo" =~ ^(This\ commit|This\ change|Updated|Added|Fixed) ]] && echo "body opens with a banned phrase"
  LC_ALL=C grep -qP '[^\x00-\x7F]' <<<"$j" && echo "output contains non-ASCII characters"
  [[ "$su" =~ \#[0-9] ]] && echo "subject contains an issue number"
  return 0
}

_hdr() { local j=$1 ty sc su; ty=$(jq -r '.type' <<<"$j"); sc=$(jq -r '.scope // ""' <<<"$j")
  su=$(jq -r '.subject' <<<"$j"); [ -n "$sc" ] && echo "$ty($sc): $su" || echo "$ty: $su"; }
_body() { jq -r '.body' <<<"$1" | fold -s -w 72 | sed 's/[[:space:]]*$//'; }

render() { local j; j=$(cat); printf '%s\n\n%s\n' "$(_hdr "$j")" "$(_body "$j")"; }
apply()  { local j; j=$(cat); confirm "commit? [y/N]"
           git commit -m "$(_hdr "$j")" -m "$(_body "$j")"; }
