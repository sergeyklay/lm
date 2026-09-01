name="release"
description="Cut a release: pick the next version, date the pending changelog section, commit, tag and push it"

_current() { jq -r '.version // empty' package.json 2>/dev/null; }

_next() { # $1 current version, $2 major|minor|patch
  local x y z; IFS=. read -r x y z <<<"$1"
  case "$2" in
    major) printf '%s.0.0' "$((x + 1))" ;;
    minor) printf '%s.%s.0' "$x" "$((y + 1))" ;;
    patch) printf '%s.%s.%s' "$x" "$y" "$((z + 1))" ;;
  esac
}

# The heading's date, behind a function so tests/golden can pin it: render()
# prints the dated heading, and the clock would move the expectation nightly.
_today() { date +%F; }

# Everything between the [Unreleased] heading and the release under it.
_pending() { awk '/^## \[Unreleased\]/ { f = 1; next } f && /^## \[/ { exit } f' CHANGELOG.md; }

_entries() { _pending | grep -c '^- ' || true; }

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }

  [ -f package.json ] || { echo "lm: package.json not found in the repository root" >&2; return 3; }
  [ -f CHANGELOG.md ] || { echo "lm: CHANGELOG.md not found in the repository root" >&2; return 3; }

  local cur; cur=$(_current)
  if [[ ! "$cur" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "lm: package.json carries no plain major.minor.patch version" >&2
    return 3
  fi
  if ! grep -q '^## \[Unreleased\]' CHANGELOG.md; then
    echo "lm: CHANGELOG.md has no '## [Unreleased]' section" >&2
    return 3
  fi
  # Here rather than in apply(): the entries under [Unreleased] are what the
  # release is, so without them there is nothing to cut and the model call is
  # wasted on a version whose section would be empty.
  local n; n=$(_entries)
  if [ "$n" -eq 0 ]; then
    echo "lm: nothing under '## [Unreleased]' in CHANGELOG.md" >&2
    echo "    Draft the entries first: lm changelog" >&2
    return 3
  fi

  local want="$*" pinned="" b
  if [ -n "$want" ]; then
    for b in major minor patch; do
      [ "$(_next "$cur" "$b")" = "$want" ] && pinned=$b
    done
    if [ -z "$pinned" ]; then
      echo "lm: $want is not a next version of $cur" >&2
      echo "    major $(_next "$cur" major), minor $(_next "$cur" minor), patch $(_next "$cur" patch)" >&2
      return 3
    fi
  fi

  printf '%s\n' \
    "This project is at version $cur." "" \
    "The $n entries standing under [Unreleased] in CHANGELOG.md, which is what this release carries:" \
    "$(_pending)" ""

  if [ -n "$pinned" ]; then
    printf '%s\n' \
      "The person running this asked for version $want, which is the $pinned bump of $cur." \
      "Answer \"$pinned\" for the bump." ""
  else
    printf '%s\n' \
      "Choose the bump these entries call for, as Semantic Versioning defines it:" \
      "  major when something that used to work no longer does." \
      "  minor when there is functionality that was not there before and nothing was broken." \
      "  patch when only defects were repaired." ""
  fi

  printf '%s\n' \
    "Write the summary the annotated tag carries." \
    "Say what the whole set of entries above gives the person who installs this release," \
    "not what any one of them changed." \
    "One unwrapped line, under 90 characters, lower case at the start, no trailing period." \
    "Do not name the version: it is written in front of your summary for you."
}

schema() {
  jq -n -c '{
    type:"object",
    properties:{
      bump:{type:"string",enum:["major","minor","patch"]},
      summary:{type:"string",maxLength:120}
    },
    required:["bump","summary"]
  }'
}

validate() {
  local j su
  j=$(cat)
  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }

  su=$(jq -r '.summary // ""' <<<"$j")

  [ -z "${su//[[:space:]]/}" ] && echo "tag summary is empty"
  case "$su" in
    *$'\n'*) echo "tag summary contains a line break; write it as one unwrapped line" ;;
  esac
  [[ "$su" =~ \.$ ]] && echo "tag summary ends with a period"
  [[ "$su" =~ ^[A-Z] ]] && echo "tag summary starts with a capital letter"
  (( ${#su} >= 90 )) && echo "tag summary is ${#su} chars, must be under 90"
  [[ "$su" =~ ^(lm[[:space:]]|v?[0-9]+\.[0-9]+\.[0-9]+) ]] && echo "tag summary names the version, which is written in front of it for you"
  LC_ALL=C grep -qP '[^\x00-\x7F]' <<<"$j" && echo "output contains non-ASCII characters"

  return 0
}

render() {
  local j cur v su
  j=$(cat)
  cur=$(_current); v=$(_next "$cur" "$(jq -r '.bump' <<<"$j")"); su=$(jq -r '.summary' <<<"$j")
  printf 'chore(release): cut %s\n\n' "$v"
  printf '  package.json       %s -> %s\n'   "$cur" "$v"
  printf '  package-lock.json  %s -> %s\n'   "$cur" "$v"
  printf '  CHANGELOG.md       %s entries -> ## [%s] - %s\n\n' "$(_entries)" "$v" "$(_today)"
  printf 'v%s\n' "$v"
  printf '  lm %s - %s\n' "$v" "$su"
}

# The accumulated entries stay where they are and a dated heading is opened above
# them, so [Unreleased] is left empty and nothing outside that window moves.
_date_section() { # $1 version, $2 date
  awk -v h="## [$1] - $2" '{ print } !d && /^## \[Unreleased\]/ { print ""; print h; d = 1 }' CHANGELOG.md
}

# The foot's comparison links: [Unreleased] moves up to the new tag and the
# release it left behind gets a row of its own.
_relink() { # $1 version
  awk -v v="$1" '
    /^\[Unreleased\]: / {
      url = $0; sub(/^\[Unreleased\]: /, "", url); sub(/\.\.\.HEAD$/, "", url)
      base = url; sub(/\/v[^\/]*$/, "", base)
      print "[Unreleased]: " base "/v" v "...HEAD"
      print "[" v "]: " url "...v" v
      next
    }
    { print }' CHANGELOG.md
}

apply() {
  local j cur v su
  j=$(cat)
  cur=$(_current); v=$(_next "$cur" "$(jq -r '.bump' <<<"$j")"); su=$(jq -r '.summary' <<<"$j")

  confirm "Cut and push $v? [y/N]"

  jq --arg v "$v" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json
  npm install --package-lock-only >/dev/null

  _date_section "$v" "$(_today)" > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md
  _relink "$v"                   > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md

  git commit -q -m "chore(release): cut $v" -- package.json package-lock.json CHANGELOG.md
  git tag -a "v$v" -m "lm $v - $su" ||
    { echo "lm: $v is committed but could not be tagged" >&2; return 8; }
  if ! git push -q origin HEAD || ! git push -q origin "v$v"; then
    echo "lm: $v is committed and tagged here, and was not pushed" >&2
    return 8
  fi
}
