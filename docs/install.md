# Installing lm

## Requirements

`bash`, `jq`, `curl`, `git`, and a running [ollama](https://ollama.com) with a model that
honours `format`. `gh` for `issue` and `pr`.

Node 24, new enough to run TypeScript without a build step, and its packages installed.

The chat's file tools shell out to [`fd`](https://github.com/sharkdp/fd) and
[`ripgrep`](https://github.com/BurntSushi/ripgrep). Install them yourself: the chat otherwise
tries to fetch them from GitHub on first run, which fails on an unauthenticated rate limit and
leaves the tools missing.

Under `tmux`, add `set -g extended-keys on` to your configuration, or modified `Enter` keys do
not reach the chat.

The verbs need none of the chat's extras: `bash`, `jq`, `curl`, `git` and ollama are enough.

## Install

```bash
git clone https://github.com/sergeyklay/lm.git ~/lm
export PATH="$HOME/lm/bin:$PATH"
npm --prefix ~/lm ci
ollama pull qwen3.8:27b
```

Put the `export` in your shell's profile to keep it. Nothing else is written until you run a
verb: the run log appears at `$HOME/.lm/runs.jsonl` on the first run, and the chat keeps its own
session history in the harness's directory under your home directory.

## First run

```bash
lm                 # chat with the local model, verbs available inside it
lm commit          # Conventional Commits message from the staged diff
lm changelog       # CHANGELOG.md entries from the staged diff
lm issue "topic"   # a GitHub issue, labels picked from the repository
lm pr              # a pull request description
lm ship            # stage, branch, commit, pull request
lm stats           # what the run log says about this repository
```

A verb takes free text after its name, and `--dry-run` prints the result and stops before the
side effect, which is the safe way to meet a verb for the first time:

```bash
lm commit --dry-run
```

`--list` and `--which` answer questions about the registry rather than running a verb:

```bash
lm --list                      # every tool with its description, tab-separated
lm --which "text"              # name the verb that serves a request
```

What each verb does to the repository, what the exit codes mean and which environment variables
are read is in [what each verb does](verbs.md).
