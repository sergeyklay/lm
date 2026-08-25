# lm

Local developer verbs backed by a local model. One file per tool, a thin runner, no agent loop.

Each tool collects its input from the repository, asks the model once under a JSON schema, validates the answer, shows it, and only then applies it.

## Requirements

`bash`, `jq`, `curl`, `git`, and a running [ollama](https://ollama.com) with a model that honours `format`. `gh` for `issue` and `pr`, the Go toolchain for `fix`.

```bash
ollama pull qwen3.8:27b
```

## Install

```bash
git clone https://github.com/sergeyklay/lm.git ~/lm
export PATH="$HOME/lm/bin:$PATH"
```

## Use

```bash
lm commit          # Conventional Commits message from the staged diff
lm changelog       # CHANGELOG.md entry from the staged diff
lm pr              # pull request description from the commits ahead of the default branch
lm issue           # GitHub issue, labels taken from the repository
lm fix             # repair a build error, with the compiler as the oracle
```

`lm pr` fills `.github/pull_request_template.md` when the repository has one: the section
headings become the schema, and the script writes them back, so the model only supplies
the contents.

A verb takes free text after its name, and passes it to the model as what the human meant
the change to be. `lm changelog` reads the index when something is staged and the working
tree otherwise, so an entry can be drafted before anything is staged, or from the text alone
when nothing has changed at all. `lm commit` reads the index and only the index, because
that is what it commits.

`--dry-run` on any verb prints the result and stops before the side effect.

```bash
lm --list                      # every tool with its description, tab-separated
lm --which "text"              # pick the verb that serves a request
```

Configuration is environment only:

| Variable | Default |
| --- | --- |
| `LM_OLLAMA` | `http://127.0.0.1:11434` |
| `LM_MODEL` | `qwen3.8:27b` |
| `LM_CTX` | `32768` |
| `LM_TOOLS` | `<repo>/tools` |

## Adding a tool

Drop one file into `tools/`. Nothing else changes: the index is the directory listing.

```bash
name="verb"
description="One line. It is what the router sees."

collect()  { :; }   # build the prompt from the repository, deterministically
schema()   { :; }   # JSON schema of the answer, enum on every closed set
validate() { :; }   # print one line per violation, nothing when clean
render()   { :; }   # show the result to the human
apply()    { :; }   # perform the side effect
```

`validate` prints violations rather than returning a boolean: the text is fed back to the model for the single retry. `apply` asks through `confirm "text"`, which exits 7 when the human refuses. Any other prompt in `apply` must read from `/dev/tty`, because stdin carries the model's answer.

## Tests

```bash
bash tests/changelog-insert.sh    # the changelog insertion, byte for byte
bash tests/golden.sh              # every verb except the model call
```

`golden.sh` builds a fixture repository per case and pins what the verb does around the
model: the prompt `collect` writes, the shape `schema` asks for, the violations `validate`
reports and the artefact `render` assembles. `--update` rewrites the expectations; read the
diff before committing them.

## License

MIT. See [LICENSE](LICENSE).
