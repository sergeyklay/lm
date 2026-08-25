name="fix"
description="Fix mechanical build errors using the compiler as an oracle"

_diag() {
  go build ./... 2>&1 || true    # a failing build is the subject, not an error
}

collect() {
  local diag
  diag=$(_diag)
  [ -z "$diag" ] && { echo "lm: build is clean" >&2; return 3; }

  local path                    # -m1: one diagnostic per pass, the rest follow later
  path=$(echo "$diag" | grep -m1 -oP '^[a-zA-Z0-9_\-\./]+\.go')
  [ -z "$path" ] && { echo "lm: cannot isolate file path from diagnostic" >&2; return 3; }

  printf '%s\n' \
    "Build diagnostic:" "$diag" "" \
    "Current content of $path:" "$(cat "$path")" "" \
    "Fix the build error by rewriting the whole file."
}

schema() {
  jq -n -c '{
    type:"object",
    properties:{
      path:{type:"string"},
      content:{type:"string"}
    },
    required:["path","content"]
  }'
}

validate() {
  local j p c
  j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }

  p=$(jq -r '.path // ""' <<<"$j")
  c=$(jq -r '.content // ""' <<<"$j")

  [ -z "$p" ] && echo "missing file path in response"
  [ -z "$c" ] && echo "missing file content in response"

  return 0
}

render() {
  local j p
  j=$(cat)
  p=$(jq -r .path <<<"$j")
  echo "File: $p"
  echo "---"
  jq -r .content <<<"$j"
}

apply() {
  local j p; j=$(cat); p=$(jq -r .path <<<"$j")
  cp -- "$p" "$p.lmbak"
  jq -r .content <<<"$j" > "$p"
  gofmt -w -- "$p"                       # deterministic normalization, not model work
  if [ -n "$(_diag)" ]; then
    echo "lm: build still fails, reverting" >&2; mv -f -- "$p.lmbak" "$p"; exit 6
  fi
  rm -f -- "$p.lmbak"; echo "lm: build is clean"
}
