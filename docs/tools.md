# Adding a tool

Drop one file into `tools/`. Nothing else changes: the index is the directory listing.

```bash
name="verb"
description="One line. It is what the router sees."
flags="--force"     # optional. Anything else that looks like a flag is a typo.

collect()  { :; }   # build the prompt from the repository, deterministically
schema()   { :; }   # JSON schema of the answer, enum on every closed set
validate() { :; }   # print one line per violation, nothing when clean
render()   { :; }   # show the result to the human
apply()    { :; }   # perform the side effect
```

A verb is called as `lm <verb> [flags] [text]`, in any order. The runner takes `--dry-run`
for itself and checks every other flag against `flags`, so a typo is refused rather than
read as words. A flag the tool declared arrives as a variable, not as an argument:
`--force` becomes `LM_FORCE=1`. Only text reaches `collect`, and text after `--` is text,
dashes and all.

`schema()` is compiled to a GBNF grammar before the model is called, so a shape the
compiler rejects costs the whole request — `HTTP 400 failed to parse grammar`, ahead of any
prefill. Two limits bind every schema, at any depth. A `pattern` opens with `^` and closes
with `$`, and uses no PCRE shorthand: `\d`, `\w` and `\s` all fail, including inside a
character class, so write `[0-9]`. A `maxLength` of 2000 or more fails the same way; 1999
passes. Worse than either is a pattern the compiler neither rejects nor supports —
`^(?=.*z).*$` returns 200 and constrains nothing — so a new `pattern` is worth one throwaway
call before it ships.

`validate` prints violations rather than returning a boolean: the text is fed back to the model for the single retry. `apply` asks through `confirm "text"`, which exits 7 when the human refuses. Any other prompt in `apply` must read from `/dev/tty`, because stdin carries the model's answer.

A tool refuses with `return 3` when there is nothing to work on. The other codes are the
runner's; [`verbs.md`](verbs.md) lists them.

When `collect()` needs something the machine running the tests may not have, put the call
behind a function so a fixture can replace it. `tools/issue.sh` reads the repository's labels
through `_labels()` for that reason, and the three `issue` cases — `ls tests/golden/*/*/env`
names them — define their own `_labels()` in `env`, so `gh` is never reached and the enum the
case exists to pin is still built. Stubbing the seam beats skipping the case: a skipped case
leaves the verb's most interesting path untested and says so only in passing.

## Tests

```bash
node tests/cli.mts                # what `lm` dispatches, and its help
bash tests/changelog-insert.sh    # the changelog insertion, byte for byte
bash tests/golden.sh              # every verb except the model call
bash tests/ship.sh                # the `lm ship` composition, with the verbs stubbed
bash tests/runner.sh              # libexec/lm-verb around the model call, with curl stubbed
node tests/registry.mts           # the Node runner's bridge to a bash tool
LM_LIVE=1 node tests/verb-live.mts  # the Node runner's retry guarantee, on the real model
```

`golden.sh` builds a fixture repository per case and pins what the verb does around the
model: the prompt `collect` writes, the shape `schema` asks for, the violations `validate`
reports and the artefact `render` assembles. `--update` rewrites the expectations; read the
diff before committing them.

Two checks here have been made to go red, and that record is what makes a green run of them
worth anything. Of the three mutations of the `--which` logging that `bash -n` accepts, each
kills a different subset of the six cases in `tests/runner.sh`: dropping the trap kills five,
blanking the `which` argument kills three, and dropping the table's exclusion kills one. The
`changelog` internal-symbol check reports nothing over every bullet the changelog has published —
45 when it landed, 47 on 2026-08-26 by
`awk '/^## \[Unreleased\]/{u=1;next} /^## \[/{u=0} !u&&/^- /' CHANGELOG.md | wc -l` — and it names
the internal function the bullet that shipped in `v0.0.2` reached for, which
`git log -S 'formats the command list' -- CHANGELOG.md` locates, while passing the replacement
written by hand to fix it. Naming that function here in back quotes would publish it and turn the
check off, which is why this paragraph does not. A third: deleting the option guard from
`bin/lm`, a mutation `node --check` accepts, kills four of the six `tests/cli.mts` cases that
cover it and leaves the two asserting only the exit status, because the argument then reaches the
shell runner as a tool name and is refused with 2 there instead. The status was never the
property at risk. A fourth, over the three hashes the record carries. Seven mutations of
`log_run` and of the `--which` prompt that `bash -n` accepts were run against the eight cases
covering them, and five discriminate to a single case: hashing a constant kills only the case
that edits `collect`, the empty string in place of `null` kills only the run that never asked, a
length of `0` for a missing answer kills only its own case, dropping the `--which` prompt kills
only that one, and hashing an empty answer rather than nulling it kills only its own. Two are
broad and worth knowing as such: pinning the length to `null` kills both length cases, and
dropping the prompt hash kills four. Every one of the eight has been observed red. A fifth, over the model's own numbers: five
mutations that `bash -n` accepts cover the twelve cases holding them, and the one the task itself
named — feeding the column the wall clock instead of the reply's `total_duration` — turns four
red at once, including the two that read `lm stats`. Replacing the accumulator instead of adding
to it turns exactly the two summing cases red, treating an absent number as zero turns the two
null cases red, averaging the missing in as zero turns only the `lm stats` case red, and pinning
`ms` to zero turns only the case that says the operator's wait is inside it. All twelve have been
observed red.

`shellcheck tools/*.sh` cannot be brought to silence, and the count is the check rather than a
defect to fix. Every tool reports exactly three: `SC2148` because it carries no shebang, which
is honest — `libexec/lm-verb` sources it and never executes it — and `SC2034` twice, for `name` and
`description`, which the runner reads after sourcing and the file itself never uses. Measured
2026-08-26 across the four tools with
`for f in tools/*.sh; do shellcheck -f gcc "$f" | wc -l; done`: four, three, three, three. A
tool reporting a fourth carries something the others do not, and that is what to look at.

`changelog` is the one, and its fourth is a false positive worth leaving. Its validator matches
the backticked spans in a drafted bullet, so the regex contains literal backticks inside single
quotes, and `SC2016` reads those as a command substitution that will not expand. Quoting it any
other way changes what the pattern matches. `shellcheck -f gcc tools/changelog.sh` names the
line.
