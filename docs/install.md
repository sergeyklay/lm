# Installing lm

## Requirements

`bash`, `jq`, `curl`, `git`, and a running [ollama](https://ollama.com) with a model that honours `format`. `gh` for `issue` and `pr`.

Node 24, new enough to run TypeScript without a build step, and its packages installed.

The chat's file tools shell out to [`fd`](https://github.com/sharkdp/fd) and [`ripgrep`](https://github.com/BurntSushi/ripgrep). Install them yourself: the chat otherwise tries to fetch them from GitHub on first run, which fails on an unauthenticated rate limit and leaves the tools missing.

Under `tmux`, add `set -g extended-keys on` to your configuration, or modified `Enter` keys do not reach the chat.

The verbs need none of the chat's extras: `bash`, `jq`, `curl`, `git` and ollama are enough.

## Install

```bash
git clone https://github.com/sergeyklay/lm.git ~/lm
export PATH="$HOME/lm/bin:$PATH"
npm --prefix ~/lm ci
ollama pull qwen3.8:27b
```

Put the `export` in your shell's profile to keep it. Nothing else is written until you run a verb: the run log appears at `$HOME/.lm/runs.jsonl` on the first run, and the chat keeps its own session history in the harness's directory under your home directory.

Keeping it up to date is `git pull` and `npm ci` for `lm` itself. The chat harness that `npm ci` installed updates itself: every launch installs the newest release the range in `package.json` admits, into this clone alone, and the chat's header says which version it moved to when one arrived. It writes nothing to `package.json` or `package-lock.json`, so your working tree stays clean, and a launch with no network, no npm or nothing new to fetch opens on what is already installed and says nothing at all. A later `npm ci` puts the harness back to the version the lock names, and the launch after it moves forward again.

## First run

```bash
lm                 # chat with the local model, verbs available inside it
lm commit          # group the uncommitted changes and commit each group
lm changelog       # CHANGELOG.md entries from the staged diff
lm issue "topic"   # a GitHub issue, labels picked from the repository
lm pr              # a pull request description
lm ship            # branch, commit, pull request
lm release         # bump the version, date the changelog section, commit and tag
lm stats           # what the run log says about this repository
```

A verb takes free text after its name, and `--dry-run` prints the result and stops before the side effect, which is the safe way to meet a verb for the first time:

```bash
lm commit --dry-run
```

`--list` and `--which` answer questions about the registry rather than running a verb:

```bash
lm --list                      # every tool with its description, tab-separated
lm --which "text"              # name the verb that serves a request
```

The registry is the `tools/` of the repository you are standing in, so `lm` in a project that ships none has no verbs and `--list` prints nothing.

What each verb does to the repository is in [what this repository ships](instruments.md). What the exit codes mean, which environment variables are read and where the registry comes from is in [running a verb](verbs.md). What the chat does at launch is in [the runner](runner.md).
