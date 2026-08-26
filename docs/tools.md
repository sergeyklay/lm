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
bash tests/changelog-insert.sh    # the changelog insertion, byte for byte
bash tests/golden.sh              # every verb except the model call
bash tests/ship.sh                # the lm-ship composition, with the verbs stubbed
bash tests/runner.sh              # bin/lm around the model call, with curl stubbed
node tests/registry.mts           # the Node runner's bridge to a bash tool
node tests/args.mts               # lm-next's dispatch, against bin/lm
```

`golden.sh` builds a fixture repository per case and pins what the verb does around the
model: the prompt `collect` writes, the shape `schema` asks for, the violations `validate`
reports and the artefact `render` assembles. `--update` rewrites the expectations; read the
diff before committing them.

`shellcheck tools/*.sh` cannot be brought to silence, and the count is the check rather than a
defect to fix. Every tool reports exactly three: `SC2148` because it carries no shebang, which
is honest — `bin/lm` sources it and never executes it — and `SC2034` twice, for `name` and
`description`, which the runner reads after sourcing and the file itself never uses. Measured
2026-08-26 across the four tools with
`for f in tools/*.sh; do shellcheck -f gcc "$f" | wc -l; done`: four, three, three, three. A
tool reporting a fourth carries something the others do not, and that is what to look at.

`changelog` is the one, and its fourth is a false positive worth leaving. Its validator matches
the backticked spans in a drafted bullet, so the regex contains literal backticks inside single
quotes, and `SC2016` reads those as a command substitution that will not expand. Quoting it any
other way changes what the pattern matches. `shellcheck -f gcc tools/changelog.sh` names the
line.
