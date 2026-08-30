#!/usr/bin/env bash
# `lm release` driven through libexec/lm-verb with curl stubbed, against a
# throwaway repository and a bare remote of its own. Everything the verb does to
# a repository is here: the single commit, what it carries, the annotated tag,
# the push, what a rehearsal leaves alone and what a refusal leaves alone.
#
# The golden fixtures pin the four read-only functions. This is the other half:
# apply(), which no fixture can reach because confirm reads /dev/tty.

set -uo pipefail
ROOT=$(dirname "$(readlink -f "$0")")/..
ROOT=$(cd "$ROOT" && pwd)
PATH0=$PATH
fail=0

command -v script >/dev/null ||
  { echo "tests/release.sh needs util-linux script: confirm reads /dev/tty"; exit 1; }

check() { # name want got
  if [ "$2" = "$3" ]; then echo "ok   $1"; else
    echo "FAIL $1"; echo "  want: $2"; echo "  got:  $3"; fail=1
  fi
}

# Nothing here may reach a registry, and apply() runs npm.
export npm_config_registry=http://127.0.0.1:1
export LM_LOG=
export GIT_AUTHOR_NAME=lm GIT_AUTHOR_EMAIL=lm@example.invalid
export GIT_COMMITTER_NAME=lm GIT_COMMITTER_EMAIL=lm@example.invalid

ANSWER='{"bump":"minor","summary":"a second thing the demo tool can do, and the first one repaired"}'

changelog() { # $1 what stands under [Unreleased]
  printf '# Changelog\n\n## [Unreleased]\n%b\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- The first release\n\n[Unreleased]: https://example.invalid/demo/compare/v0.1.0...HEAD\n[0.1.0]: https://example.invalid/demo/releases/tag/v0.1.0\n' "$1"
}
FULL='\n### Added\n\n- A second thing the demo tool can do\n\n### Fixed\n\n- The demo tool no longer forgets the first thing\n\n'
EMPTY='\n'

# $1 the model reply, $@ the rest unused. The registry is this repository's own
# tools/, so the file under test is the one that ships.
setup() { # $1 model reply, $2 what stands under [Unreleased]
  work=$(mktemp -d); mkdir -p "$work/bin" "$work/replies"
  printf '%s' "$1" > "$work/replies/1"
  cat > "$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$REPLIES/n" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$REPLIES/n"
cat > "$REPLIES/req.$n"
cat "$REPLIES/$n" 2>/dev/null
EOF
  chmod +x "$work/bin/curl"
  export REPLIES="$work/replies" PATH="$work/bin:$PATH0" LM_TOOLS="$ROOT/tools"
  origin="$work/origin.git"
  git init -q --bare "$origin"
  repo="$work/repo"
  mkdir -p "$repo"; cd "$repo" || exit 1
  git init -q -b main .
  git remote add origin "$origin"
  printf '{\n  "name": "demo",\n  "version": "0.1.0",\n  "private": true\n}\n' > package.json
  printf '{\n  "name": "demo",\n  "version": "0.1.0",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {\n    "": {\n      "name": "demo",\n      "version": "0.1.0"\n    }\n  }\n}\n' > package-lock.json
  changelog "$2" > CHANGELOG.md
  git add .; git commit -qm "chore: seed the repository"
  HEAD0=$(git rev-parse HEAD)
}

teardown() { cd /; rm -rf "$work"; }

calls() { cat "$REPLIES/n" 2>/dev/null || echo 0; }
lm() { "$ROOT/libexec/lm-verb" "$@"; }
# script owns the terminal it lends to confirm, and echoes back through it.
tty_lm() { local a=$1; shift; script -qec "$ROOT/libexec/lm-verb $*" /dev/null <<<"$a" | tr -d '\r'; }

# A cut the operator approves: one commit, one annotated tag, both pushed.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
DAY=$(date +%F)
out=$(tty_lm y release); rc=$?
check "a cut exits 0"                       "0" "$rc"
check "and lands exactly one commit"        "1" "$(git rev-list --count "$HEAD0"..HEAD)"
check "whose subject names the version"     "chore(release): cut 0.2.0" "$(git log -1 --format='%s')"
check "and which carries the three together" \
  "CHANGELOG.md package-lock.json package.json" \
  "$(git show --name-only --format='' HEAD | LC_ALL=C sort | paste -sd' ')"
check "package.json says the new version"   "0.2.0" "$(jq -r .version package.json)"
check "and so does package-lock.json"       "0.2.0" "$(jq -r .version package-lock.json)"
check "the [Unreleased] section is emptied" "" \
  "$(awk '/^## \[Unreleased\]/{f=1;next} f&&/^## \[/{exit} f' CHANGELOG.md | tr -d '[:space:]')"
check "the entries stand under a dated heading" "2" \
  "$(awk -v h="## [0.2.0] - $DAY" '$0==h{f=1;next} f&&/^## \[/{exit} f&&/^- /{c++} END{print c+0}' CHANGELOG.md)"
check "the foot link for the release is added" \
  "[0.2.0]: https://example.invalid/demo/compare/v0.1.0...v0.2.0" \
  "$(grep '^\[0.2.0\]:' CHANGELOG.md)"
check "and [Unreleased] compares from the new tag" \
  "[Unreleased]: https://example.invalid/demo/compare/v0.2.0...HEAD" \
  "$(grep '^\[Unreleased\]:' CHANGELOG.md)"
check "the tag is annotated"                "tag" "$(git cat-file -t v0.2.0)"
check "and reads lm <version> - <summary>" \
  "lm 0.2.0 - a second thing the demo tool can do, and the first one repaired" \
  "$(git tag -l --format='%(contents:subject)' v0.2.0)"
check "the branch reached the remote"       "$(git rev-parse HEAD)" \
  "$(git --git-dir="$origin" rev-parse refs/heads/main)"
check "and so did the tag"                  "v0.2.0" "$(git --git-dir="$origin" tag -l)"
check "one model call paid for all of it"   "1" "$(calls)"
check "the render named the commit"         "1" "$(grep -c '^chore(release): cut 0.2.0$' <<<"$out")"
check "and the tag beside it"               "1" "$(grep -c 'lm 0.2.0 - a second thing' <<<"$out")"
teardown

# The rehearsal. It renders the same two things and touches nothing.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
before=$(md5sum package.json CHANGELOG.md | md5sum)
out=$(tty_lm y release --dry-run); rc=$?
check "a rehearsal exits 0"                 "0" "$rc"
check "and renders the commit"              "1" "$(grep -c '^chore(release): cut 0.2.0$' <<<"$out")"
check "and the tag it would write"          "1" "$(grep -c 'lm 0.2.0 - a second thing' <<<"$out")"
check "and says it did nothing"             "1" "$(grep -c 'no side effect' <<<"$out")"
check "and leaves HEAD where it was"        "$HEAD0" "$(git rev-parse HEAD)"
check "and the manifest and changelog too"  "$before" "$(md5sum package.json CHANGELOG.md | md5sum)"
check "and writes no tag"                   "" "$(git tag -l)"
check "and pushes nothing"                  "" "$(git --git-dir="$origin" tag -l)"
teardown

# A refusal leaves the repository exactly as it found it.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
before=$(md5sum package.json CHANGELOG.md | md5sum)
tty_lm n release >/dev/null 2>&1; rc=$?
check "a refused cut exits 7"               "7" "$rc"
check "and a refusal leaves HEAD alone"     "$HEAD0" "$(git rev-parse HEAD)"
check "and the manifest and changelog with it" "$before" "$(md5sum package.json CHANGELOG.md | md5sum)"
check "and writes no tag either"            "" "$(git tag -l)"
teardown

# What the model is asked for. The bump is a closed set the tool does the
# arithmetic on, so an answer can name no version the arithmetic did not produce.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
lm release --dry-run >/dev/null 2>&1
check "the bump is a closed set of three"   "major,minor,patch" \
  "$(jq -r '.format.properties.bump.enum | join(",")' "$REPLIES/req.1")"
check "and nothing else is enumerated"      "bump" \
  "$(jq -r '.format.properties | to_entries | map(select(.value.enum)) | map(.key) | join(",")' "$REPLIES/req.1")"
check "the prompt says where the project is" "1" \
  "$(jq -r '.messages[0].content' "$REPLIES/req.1" | grep -c '^This project is at version 0.1.0.$')"
teardown

# A version the operator names is the arithmetic's, and pins the bump.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
lm release --dry-run 1.0.0 >/dev/null 2>&1
check "a named version pins the bump"       "1" \
  "$(jq -r '.messages[0].content' "$REPLIES/req.1" | grep -c 'Answer "major" for the bump.')"
out=$(lm release 0.5.0 2>&1); rc=$?
check "one the arithmetic cannot reach exits 3" "3" "$rc"
check "and names the three that it can"     "    major 1.0.0, minor 0.2.0, patch 0.1.1" \
  "$(grep '^    major' <<<"$out")"
check "and costs no model call"             "1" "$(calls)"
teardown

# The guards collect() runs before the model call.
setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$EMPTY"
out=$(lm release 2>&1); rc=$?
check "an empty [Unreleased] exits 3"       "3" "$rc"
check "and says there is nothing under it"  "1" "$(grep -c "nothing under '## \[Unreleased\]'" <<<"$out")"
check "before any model call"               "0" "$(calls)"
teardown

setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
rm package.json
out=$(lm release 2>&1); rc=$?
check "no package.json exits 3"             "3" "$rc"
check "and says which file is missing"      "1" "$(grep -c 'package.json not found' <<<"$out")"
teardown

setup "$(jq -nc --arg c "$ANSWER" '{message:{content:$c},done_reason:"stop"}')" "$FULL"
jq '.version = "0.1.0-rc1"' package.json > p && mv p package.json
out=$(lm release 2>&1); rc=$?
check "a version that is not three numbers exits 3" "3" "$rc"
check "and says so"                         "1" "$(grep -c 'no plain major.minor.patch version' <<<"$out")"
check "and pays for no model call"          "0" "$(calls)"
teardown

[ "$fail" -eq 0 ] || { echo "FAILED"; exit 1; }
echo "all cases passed"
