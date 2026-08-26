# lm

Local developer verbs backed by a local model. One file per tool, a thin runner, no agent loop.

Each tool collects its input from the repository, asks the model once under a JSON schema, validates the answer, shows it, and only then applies it.

## Requirements

`bash`, `jq`, `curl`, `git`, and a running [ollama](https://ollama.com) with a model that honours `format`. `gh` for `issue` and `pr`.

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
lm changelog       # CHANGELOG.md entries for what changed, staged or not
lm pr              # pull request description from the commits ahead of the default branch
lm issue           # GitHub issue, labels taken from the repository
```

A verb takes free text after its name, and `--dry-run` stops it before the side effect.

```bash
lm --list                      # every tool with its description, tab-separated
lm --which "text"              # pick the verb that serves a request
lm-ship                        # branch, commit and open the pull request
lm-stats                       # what the run log says about this repository
```

## Documentation

- [What each verb does](docs/verbs.md) — per-verb behaviour, the two compositions,
  configuration and exit codes.
- [Adding a tool](docs/tools.md) — the registry contract, and the tests that pin it.
- [The runner](docs/runner.md) — the two runners, and how the Node one reaches a bash tool.

## License

MIT. See [LICENSE](LICENSE).
