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

`validate` prints violations rather than returning a boolean: the text is fed back to the model for the single retry. `apply` asks through `confirm "text"`, which exits 7 when the human refuses. Any other prompt in `apply` must read from `/dev/tty`, because stdin carries the model's answer.

A tool refuses with `return 3` when there is nothing to work on. The other codes are the
runner's; [`verbs.md`](verbs.md) lists them.

## Tests

```bash
bash tests/changelog-insert.sh    # the changelog insertion, byte for byte
bash tests/golden.sh              # every verb except the model call
bash tests/ship.sh                # the lm-ship composition, with the verbs stubbed
bash tests/runner.sh              # bin/lm around the model call, with curl stubbed
```

`golden.sh` builds a fixture repository per case and pins what the verb does around the
model: the prompt `collect` writes, the shape `schema` asks for, the violations `validate`
reports and the artefact `render` assembles. `--update` rewrites the expectations; read the
diff before committing them.
