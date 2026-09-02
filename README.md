# lm

**A coding agent that never leaves your machine.**

A chat against a model on your own hardware, this repository's own verbs available inside it, and every run recorded in a log you can read. No account and no API key, and nothing you type or stage is sent anywhere: `issue` and `pr` reach GitHub because publishing is what they are for, an [MCP server](docs/mcp.md) is reached only because you configured one, and nothing else leaves the machine.

`lm` does not make a local model as good as a hosted one. What it does is give the model a job small enough to be reliable: each verb collects its input from the repository, asks the model once under a JSON schema, validates the answer, shows it to you, and only then applies it.

## Install

```bash
git clone https://github.com/sergeyklay/lm.git ~/lm
export PATH="$HOME/lm/bin:$PATH"
npm --prefix ~/lm ci
```

Requirements and the first run: [installing lm](docs/install.md).

## The problem

A hosted coding agent is excellent and it is also a subscription, a network dependency and a copy of your repository on someone else's disk. A local model is none of those, and on its own it is worse at everything. The gap closes when the work is narrow: writing a commit message from a diff, drafting a changelog entry, filling a pull request template. Those are the jobs a 27B model on one consumer GPU does well, and they are most of what an agent is asked for in a day.

## How it works

One command over a directory of tool files. Each file declares the shell functions below, and the runner calls them in order:

```bash
name="commit"
description="Split the uncommitted changes into logical commits, each with a Conventional Commits message"

collect()  { git diff HEAD; }        # build the prompt from the repository
schema()   { ... }                   # the answer's shape, an enum on every closed set
validate() { ... }                   # print one line per violation, nothing when clean
render()   { ... }                   # show the result to the human
apply()    { confirm "3 commit(s)? [y/N]"; ... }  # the side effect, once the human agrees
```

The model never picks a value that can be enumerated: scopes, labels and template sections are built from the repository at call time, so the answer cannot name something that does not exist. A rejected answer is sent back once with the violations as the correction, and a verb costs one model call, or two when the validator rejects the first.

Adding a verb changes no existing file. The index is the directory listing, so a file dropped in is available on the command line at once, and inside the chat from the next session. That holds for a file dropped into a repository of your own, which [running a verb](docs/verbs.md) covers.

## Documentation

- [Installing lm](docs/install.md): requirements, install, first run.
- [What this repository ships](docs/instruments.md): what each verb does, and `ship`.
- [Running a verb](docs/verbs.md): the flags every verb takes, the run log `lm stats` reads, configuration and exit codes.
- [Adding a tool](docs/tools.md): the registry contract, and the tests that pin it.
- [MCP servers in the chat](docs/mcp.md): where a server is declared, what the launch says, and what the model is offered.
- [The runner](docs/runner.md): how a verb reaches the model, and how the chat reaches a verb.

## Why "lm"

Two letters, the ones in "local model", and short enough to type before `commit` without resenting it.

## License

MIT. See [LICENSE](LICENSE).
