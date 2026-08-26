# lm

A local replacement for a hosted coding agent: a chat against a model on your own machine, this repository's verbs beside it, and the run log as a dashboard.

Each tool collects its input from the repository, asks the model once under a JSON schema, validates the answer, shows it, and only then applies it.

## Requirements

`bash`, `jq`, `curl`, `git`, and a running [ollama](https://ollama.com) with a model that honours `format`. `gh` for `issue` and `pr`.

Node 24, new enough to run TypeScript without a build step, and its packages installed.

The chat's file tools shell out to [`fd`](https://github.com/sharkdp/fd) and [`ripgrep`](https://github.com/BurntSushi/ripgrep). Install them yourself: the chat otherwise tries to fetch them from GitHub on first run, which fails on an unauthenticated rate limit and leaves the tools missing.

Under `tmux`, add `set -g extended-keys on` to your configuration, or modified `Enter` keys do not reach the chat.

```bash
ollama pull qwen3.8:27b
```

## Install

```bash
git clone https://github.com/sergeyklay/lm.git ~/lm
export PATH="$HOME/lm/bin:$PATH"
npm --prefix ~/lm ci
```

## Use

```bash
lm                 # chat with the local model
lm commit          # Conventional Commits message from the staged diff
lm changelog       # CHANGELOG.md entries from the staged diff
lm issue "topic"   # a GitHub issue, labels picked from the repository
lm pr              # a pull request description
lm ship            # stage, branch, commit, pull request
lm stats           # what the run log says about this repository
```

A verb takes free text after its name, and `--dry-run` stops it before the side effect.

```bash
lm --list                      # every tool with its description, tab-separated
lm --which "text"              # pick the verb that serves a request
lm ship                        # stage, branch, commit and open the pull request
lm stats                       # what the run log says about this repository
```

## Documentation

- [What each verb does](docs/verbs.md) — per-verb behaviour, the two compositions,
  configuration and exit codes.
- [Adding a tool](docs/tools.md) — the registry contract, and the tests that pin it.
- [The runner](docs/runner.md) — the two runners, and how the Node one reaches a bash tool.

## License

MIT. See [LICENSE](LICENSE).
