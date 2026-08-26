name="changelog"
description="Draft CHANGELOG.md entries under [Unreleased] from the index, the working tree or free text"

collect() {
  git rev-parse --git-dir >/dev/null 2>&1 || { echo "lm: not a git repository" >&2; return 2; }

  if [ ! -f "CHANGELOG.md" ]; then
    echo "lm: CHANGELOG.md not found in the repository root" >&2
    return 3
  fi
  # Here rather than in apply(): the section is what the entry is written into,
  # so without it there is nothing to draft and the model call is wasted.
  if ! grep -q "^## \[Unreleased\]" CHANGELOG.md; then
    echo "lm: CHANGELOG.md has no '## [Unreleased]' section" >&2
    return 3
  fi

  # The index first, then the working tree. A changelog entry describes a change,
  # and a change is no less real for not being staged yet. This is the opposite
  # of the commit verb, which must read the index because that is what it commits.
  local diff files label said="$*"
  diff=$(git diff --cached); label="Staged diff to document:"
  files=$(git diff --cached --name-only)
  if [ -n "$diff" ]; then
    # Reading the index is the quiet case; reading it while the tree holds more
    # is the one worth a word, because the entry will not cover the remainder.
    local rest; rest=$(git diff --name-only | paste -sd' ')
    [ -n "$rest" ] && echo "lm: not staged, so not described here: $rest" >&2
  else
    diff=$(git diff); files=$(git diff --name-only)
    label="Working tree diff to document:"
  fi
  if [ -z "$diff" ] && [ -z "$said" ]; then
    echo "lm: nothing staged and nothing changed in the working tree." >&2
    echo "    Change something, or say what changed: lm changelog \"...\"" >&2
    return 3
  fi

  # The whole changelog, newest first, capped. Measured on one diff in this
  # repository, by reading the bullets rather than counting keywords, and the
  # same at temperature 0 and 0.7: this prompt yielded one entry about test
  # code, filler of the same length yielded sixteen entries with several about
  # test code, and the published changelog yielded none. Why it works is not
  # established. A larger corpus of good entries plausibly sets altitude and
  # brevity whatever the subject, and that is a guess, not the measurement.
  local published
  published=$(head -c 12000 CHANGELOG.md)

  printf '%s\n' \
    "The changelog this project has published so far. It records what this project considers" \
    "worth telling its users, and by omission what it does not. Match both:" "$published" ""

  [ -n "$said" ] && printf '%s\n' \
    "The person running this described the change as follows. Treat it as what they meant," \
    "not as wording to copy, and still take the facts from the diff below when there is one:" \
    "$said" ""

  [ -n "$diff" ] && printf '%s\n' \
    "Files changed:" "$files" "" \
    "$label" "$(printf '%s' "$diff" | head -c 40000)" ""

  # The six category definitions below look self-evident and are not: across eight
  # runs without them the model produced no Changed entry at all for a release
  # that needed three. A prompt-trimming pass that deletes them will not see the
  # regression until a release ships with a whole category missing.
  printf '%s\n' \
    "Write an entry for each change a person could notice by installing this project and running it." \
    "If they could not notice it that way there is no entry, and a diff often yields fewer entries than it has files." \
    "One entry per observable change, not one per file." \
    "Categories, as Keep a Changelog defines them:" \
    "  Added for new features." \
    "  Changed for changes in existing functionality." \
    "  Deprecated for soon-to-be removed features." \
    "  Removed for now removed features." \
    "  Fixed for any bug fixes." \
    "  Security in case of vulnerabilities." \
    "Each entry must make plain what changed for the person on the other side of it." \
    "Length follows the change: one sentence usually, two when one would leave the reader guessing." \
    "An entry is not a manual and not a design note: no usage instructions, no rationale, no implementation detail." \
    "Unless this repository is plainly a library or a framework, its internals are out of scope: describe what someone running it observes, not what a script defines." \
    "Start with the thing that changed, never with the category name:" \
    "write \"Support for X in the Y command\", not \"Added support for X\"." \
    "Write each entry as one unwrapped line, with no line breaks."
}

schema() {
  jq -n -c '{
    type:"object",
    properties:{
      entries:{
        type:"array",
        minItems:1,
        items:{
          type:"object",
          properties:{
            category:{type:"string",enum:["Added","Changed","Deprecated","Removed","Fixed","Security"]},
            bullet:{type:"string"}
          },
          required:["category","bullet"]
        }
      }
    },
    required:["entries"]
  }'
}

validate() {
  local j n i catg bullet tok _root
  # The contract and the source both live in lm's own tree, not in the repository
  # the verb is drafting for, so the root comes from where the registry was found.
  _root=$(dirname "${LM_TOOLS:-$(dirname "${BASH_SOURCE[0]}")}")
  j=$(cat)

  jq -e . >/dev/null 2>&1 <<<"$j" || { echo "output is not valid JSON"; return 0; }

  n=$(jq '.entries | length' <<<"$j" 2>/dev/null || echo 0)
  [ "${n:-0}" -eq 0 ] && { echo "no entries: give one entry per user-visible change in the diff"; return 0; }

  for ((i = 0; i < n; i++)); do
  catg=$(jq -r --argjson i "$i" '.entries[$i].category // ""' <<<"$j")
  bullet=$(jq -r --argjson i "$i" '.entries[$i].bullet // ""' <<<"$j")

  [ -z "$catg" ] && echo "entry $((i + 1)): category is empty"
  [ -z "$bullet" ] && echo "entry $((i + 1)): bullet is empty"

  # A bullet is one sentence on one line. Tested with bash, not with grep:
  # grep is line-oriented, so a '\n' in the pattern can never match.
  case "$bullet" in
    *$'\n'*) echo "entry $((i + 1)): bullet contains a line break; write the whole entry as one unwrapped line" ;;
  esac

  case "$bullet" in
    Added\ *|Changed\ *|Deprecated\ *|Removed\ *|Fixed\ *|Security\ *)
      echo "entry $((i + 1)): bullet repeats the category name; drop that first word and start with the thing that changed, as in \"Support for X in the Y command\"" ;;
  esac

  [[ "$bullet" =~ (No\ migration|Nothing\ to\ do) ]] && echo "entry $((i + 1)): bullet documents a non-event (absence of a change)"

  # A bullet may name what a user can see. The functions docs/tools.md publishes
  # are legitimate — a tool author writes against them — but the project's other
  # functions are not: `usage` formats the listing a user reads, and the user has
  # no word for it. Both halves are read rather than listed here, so publishing a
  # seventh contract function needs no edit to this file. A leading underscore is
  # this project's own mark for a private helper, and docs/tools.md naming one as
  # an example of a seam does not publish it.
  while IFS= read -r tok; do
    case "$tok" in ""|*[!a-zA-Z0-9_]*) continue ;; esac
    grep -qE "^$tok\(\)" "$_root"/libexec/* "$_root"/tools/*.sh 2>/dev/null || continue
    case "$tok" in _*) ;; *) grep -qE "\`$tok([^a-zA-Z0-9_]|\$)" "$_root/docs/tools.md" 2>/dev/null && continue ;; esac
    echo "entry $((i + 1)): bullet names '$tok', which is internal to the source; name what the user sees instead"
  done < <(grep -oE '`[^`]+`' <<<"$bullet" | tr -d '`')
  done

  return 0
}

render() {
  echo "Proposed for CHANGELOG.md under [Unreleased]:"
  echo ""
  jq -r '.entries | group_by(.category)[]
    | "### " + .[0].category, "", (.[] | "- " + .bullet), ""'
}

# _insert <category> <bullet text>
# Reads a changelog on stdin, writes it back with the bullet inserted, and
# touches nothing outside the [Unreleased] window. Newest entry first, and a
# category that does not exist yet is created in Keep a Changelog order.
# Kept separate from apply() so it can be exercised by tests/changelog-insert.sh
# without a model call.
_insert() {
  awk -v catname="$1" -v bullet="- $2" '
    function order(c) {
      if (c == "Added")      return 1
      if (c == "Changed")    return 2
      if (c == "Deprecated") return 3
      if (c == "Removed")    return 4
      if (c == "Fixed")      return 5
      if (c == "Security")   return 6
      return 99
    }
    { L[NR] = $0 }
    END {
      n = NR
      us = 0
      for (i = 1; i <= n; i++) if (L[i] ~ /^## \[Unreleased\]/) { us = i; break }
      if (us == 0) { for (i = 1; i <= n; i++) print L[i]; exit 1 }

      ue = n + 1                    # first line past the [Unreleased] window
      for (i = us + 1; i <= n; i++) if (L[i] ~ /^## \[/) { ue = i; break }

      hdr = "### " catname
      ci = 0
      for (i = us + 1; i < ue; i++) if (L[i] == hdr) { ci = i; break }

      if (ci > 0) {                 # category is there: the bullet goes first under it
        at = ci + 1
        if (at < ue && L[at] == "") at++
        ins[1] = bullet; k = 1
      } else {                      # category is missing: create it in canonical order
        at = 0
        for (i = us + 1; i < ue; i++)
          if (L[i] ~ /^### / && order(substr(L[i], 5)) > order(catname)) { at = i; break }
        if (at > 0) {
          ins[1] = hdr; ins[2] = ""; ins[3] = bullet; ins[4] = ""; k = 4
        } else {                    # nothing sorts after it: append at the end of the window
          last = us
          for (i = us + 1; i < ue; i++) if (L[i] != "") last = i
          at = last + 1
          ins[1] = ""; ins[2] = hdr; ins[3] = ""; ins[4] = bullet; k = 4
        }
      }

      for (i = 1; i <= n; i++) {
        if (i == at) for (j = 1; j <= k; j++) print ins[j]
        print L[i]
      }
      if (at > n) for (j = 1; j <= k; j++) print ins[j]
    }'
}

apply() {
  local j n i catg bullet out
  j=$(cat)

  confirm "Apply to CHANGELOG.md? [y/N]"

  n=$(jq '.entries | length' <<<"$j")
  out=$(cat CHANGELOG.md)
  # Backwards, because _insert puts each bullet first under its category: the
  # one written last is the one that ends up on top.
  for ((i = n - 1; i >= 0; i--)); do
    catg=$(jq -r --argjson i "$i" '.entries[$i].category' <<<"$j")
    bullet=$(jq -r --argjson i "$i" '.entries[$i].bullet' <<<"$j")
    out=$(_insert "$catg" "$bullet" <<<"$out")
  done
  printf '%s\n' "$out" > CHANGELOG.tmp && mv CHANGELOG.tmp CHANGELOG.md

  echo "Appended $n to CHANGELOG.md. Don't forget to 'git add CHANGELOG.md'."
}
