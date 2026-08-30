name="commit"
description="Split the uncommitted changes into logical commits, each with a Conventional Commits message"
flags="--no-stage"

# The empty tree stands in for HEAD in a repository that has no commit yet, so
# every diff below has a base to run against.
_base() { git rev-parse -q --verify HEAD 2>/dev/null || git hash-object -t tree /dev/null; }

# git diff --no-index exits 1 on a difference, which is every call here, and the
# runner sources this file under set -e.
_new() { local f; git ls-files --others --exclude-standard | while IFS= read -r f; do
    git diff --no-index "$@" -- /dev/null "$f" || true; done; }

_files() {
  if [ -n "${LM_NO_STAGE:-}" ]; then git diff --cached --name-only
  else { git diff "$(_base)" --name-only; git ls-files --others --exclude-standard; }
  fi | sort -u
}

_diff() {
  if [ -n "${LM_NO_STAGE:-}" ]; then git diff --cached
  else git diff "$(_base)"; _new
  fi
}

_numstat() {
  if [ -n "${LM_NO_STAGE:-}" ]; then git diff --cached --numstat --no-renames
  else git diff "$(_base)" --numstat --no-renames
       _new --numstat | sed 's|\t/dev/null => |\t|'
  fi
}

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }
  local diff files style said="$*"
  files=$(_files)
  if [ -z "$files" ]; then
    if [ -n "${LM_NO_STAGE:-}" ]; then
      echo "lm: nothing staged, and --no-stage takes the index alone" >&2
    else
      echo "lm: nothing to commit" >&2
    fi
    return 3
  fi
  diff=$(_diff)
  style=$(git log --format='%s' -20 2>/dev/null || true)
  printf '%s\n' \
    "Recent commit subjects in this repository. Match their vocabulary and level of detail:" "$style" "" \
    "Changed files:" "$files" "" \
    "Diff:" "$(printf '%s' "$diff" | head -c 20000)" ""

  [ -n "$said" ] && printf '%s\n' \
    "The person running this described the work as follows. Treat it as what they meant," \
    "not as wording to copy, and still take the facts from the diff above:" "$said" ""

  printf '%s\n' \
    "Split these changes into commits. One commit per independent change: a change is" \
    "independent when it could be reverted on its own without breaking the others." \
    "Every file listed above must appear in exactly one commit, and no other file may" \
    "appear. Write the Conventional Commits message for each commit." \
    "Subject: imperative mood, lower case after the colon, no trailing period, under 60 characters, no issue number." \
    "Body: two or three sentences saying what changed and why. No bullet lists, no file names, no phrases like 'This commit'."
}

schema() {   # the file and scope enums are built from the repository at call time
  local scopes files
  scopes=$(_numstat | awk -F'\t' '{
      w=($1=="-"?0:$1)+($2=="-"?0:$2); split("",c); n=split($3,p,"/")
      for (i=1;i<n;i++){ c[p[i]]=1; if(i+1<n) c[p[i]"/"p[i+1]]=1 }
      m=split(p[n],b,"."); if(m>1) c[b[1]]=1
      for (k in c) weight[k]+=w }
      END{ for (k in weight) printf "%d\t%s\n", weight[k], k }' \
    | sort -k1,1nr -k2,2 | cut -f2 \
    | grep -vE '^(src|internal|pkg|cmd|lib|app|test|tests|docs?)$' | head -25)
  files=$(_files)
  jq -nc --arg scopes "$scopes" --arg files "$files" '
    def lines: if . == "" then [] else split("\n") end;
    {type:"object",
     properties:{groups:{type:"array",minItems:1,items:{
       type:"object",
       properties:{
         files:{type:"array",items:{type:"string",enum:($files|lines)}},
         type:{type:"string",enum:["feat","fix","docs","style","refactor","perf","test","chore","ci","build","revert"]},
         scope:{type:"string",enum:(($scopes|lines)+[""])},
         subject:{type:"string",maxLength:60},
         body:{type:"string"}},
       required:["files","type","scope","subject","body"]}}},
     required:["groups"]}'
}

validate() {
  local j n i g ty sc su bo line claimed f
  j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }
  n=$(jq '.groups | length' <<<"$j")
  [ "$n" -gt 0 ] || { echo "the answer splits the changes into no commits"; return 0; }

  claimed=$(jq -r '.groups[].files[]?' <<<"$j" | sort)
  while IFS= read -r f; do [ -n "$f" ] && echo "$f is in more than one commit"
  done < <(uniq -d <<<"$claimed")
  while IFS= read -r f; do [ -n "$f" ] && echo "$f changed but is in no commit"
  done < <(comm -23 <(_files) <(uniq <<<"$claimed"))

  for (( i = 0; i < n; i++ )); do
    g=$(jq -c ".groups[$i]" <<<"$j")
    [ "$(jq '.files | length' <<<"$g")" -gt 0 ] || echo "commit $((i + 1)) lists no files"
    ty=$(jq -r '.type' <<<"$g"); sc=$(jq -r '.scope // ""' <<<"$g")
    su=$(jq -r '.subject' <<<"$g"); bo=$(jq -r '.body' <<<"$g")
    line=$([ -n "$sc" ] && echo "$ty($sc): $su" || echo "$ty: $su")
    [[ "$su" =~ ^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert): ]] && echo "commit $((i + 1)): subject repeats the type prefix"
    [[ "$su" =~ \.$ ]] && echo "commit $((i + 1)): subject ends with a period"
    [[ "$su" =~ ^[A-Z] ]] && echo "commit $((i + 1)): subject starts with a capital letter"
    (( ${#line} >= 72 )) && echo "commit $((i + 1)): header is ${#line} chars, must be under 72"
    [[ "$bo" =~ ^(This\ commit|This\ change|Updated|Added|Fixed) ]] && echo "commit $((i + 1)): body opens with a banned phrase"
    LC_ALL=C grep -qP '[^\x00-\x7F]' <<<"$g" && echo "commit $((i + 1)): output contains non-ASCII characters"
    [[ "$su" =~ \#[0-9] ]] && echo "commit $((i + 1)): subject contains an issue number"
  done
  return 0
}

_hdr() { local j=$1 ty sc su; ty=$(jq -r '.type' <<<"$j"); sc=$(jq -r '.scope // ""' <<<"$j")
  su=$(jq -r '.subject' <<<"$j"); [ -n "$sc" ] && echo "$ty($sc): $su" || echo "$ty: $su"; }
_body() { jq -r '.body' <<<"$1" | fold -s -w 72 | sed 's/[[:space:]]*$//'; }

render() {
  local j n i g
  j=$(cat); n=$(jq '.groups | length' <<<"$j")
  for (( i = 0; i < n; i++ )); do
    g=$(jq -c ".groups[$i]" <<<"$j")
    (( i )) && printf '\n'
    jq -r '.files[]' <<<"$g"
    printf '%s\n\n%s\n' "$(_hdr "$g")" "$(_body "$g")"
  done
}

_stopped() { # answer, index of the group that failed, count that landed
  local j=$1 stop=$2 landed=$3 k
  echo "lm: stopped at commit $((stop + 1)) of $(jq '.groups | length' <<<"$j")" >&2
  for (( k = 0; k < landed; k++ )); do
    echo "lm: landed: $(_hdr "$(jq -c ".groups[$k]" <<<"$j")")" >&2
  done
  echo "lm: left uncommitted:" >&2
  jq -r --argjson s "$stop" '.groups[$s:][].files[]' <<<"$j" | sed 's/^/  /' >&2
}

_narrow() { # the tree the run began with, then the files this commit leaves out
  local saved=$1; shift
  git read-tree "$saved"
  [ $# -eq 0 ] || git reset -q -- "$@"
}

apply() {
  local j n i g saved landed=0
  local -a all mine others
  j=$(cat)
  n=$(jq '.groups | length' <<<"$j")
  mapfile -t all < <(_files)
  confirm "$n commit(s)? [y/N]"
  [ -n "${LM_NO_STAGE:-}" ] || git add -A
  saved=$(git write-tree)
  for (( i = 0; i < n; i++ )); do
    g=$(jq -c ".groups[$i]" <<<"$j")
    mapfile -t mine < <(jq -r '.files[]' <<<"$g")
    mapfile -t others < <(printf '%s\n' "${all[@]}" | grep -vxF -f <(printf '%s\n' "${mine[@]}") || true)
    _narrow "$saved" "${others[@]}"
    if git commit -m "$(_hdr "$g")" -m "$(_body "$g")"; then landed=$((landed + 1)); continue; fi
    if ! git diff --quiet -- "${mine[@]}"; then
      git add -- "${mine[@]}"
      if git commit -m "$(_hdr "$g")" -m "$(_body "$g")"; then landed=$((landed + 1)); continue; fi
    fi
    _stopped "$j" "$i" "$landed"
    [ "$landed" -eq 0 ] && return 1 || return 8
  done
}
