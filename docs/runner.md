# The runner

`lm` is the only command. With no arguments it opens a chat against the local model; with a verb
it runs that verb; `lm ship` and `lm stats` reach the composition and the run log. Everything it
dispatches to lives in `libexec/`, which is not on anyone's `PATH`.

`lm --help` is written by `lm` itself and lists everything it dispatches, because the shell
runner it hands a verb to knows nothing about the chat, `ship` or `stats`. It answers wherever
`-h` or `--help` appears, so `lm commit --help` prints it too.

An argument in the first position that starts with a dash and is none of `lm`'s own options is
refused by name, with the options it could have meant, before anything is dispatched. `--list`
and `--which` are the shell runner's and pass through. `--dry-run` belongs to a verb, and the
refusal says so rather than listing it as though `lm` took it.

The chat is the harness's own interactive mode, driven through its entry point with an inline
extension that registers the local provider from `LM_OLLAMA`, `LM_MODEL` and `LM_CTX`. No
configuration file outside the repository is read.

`libexec/lm-verb` is the shell runner and still runs every verb. The Node side under `src/` is
the half being built to replace it, and it reads the same registry, so a tool file does not know
which one called it.

Node runs the TypeScript directly, with no build step, which Node 24 is new enough to do.
`bin/lm` itself carries no type annotations, because a file without an extension is not
stripped.

## The bridge to a bash tool

A tool file is a set of shell function definitions, not a program. The Node runner sources it in
a `bash` process and calls one function, then does that again, in a new process, for the next
call. One process per call is what keeps a tool from leaking state into the runner or into the
next call; `libexec/lm-verb` gets the same isolation for `list()` from a subshell.

`src/registry.mts`:

| Export | What it does |
| --- | --- |
| `list(dir)` | The index: the `*.sh` files in `dir`, sorted. Adding a tool changes no file here. |
| `meta(file)` | The declared `name`, `description` and `flags`. |
| `call(file, fn, opts)` | Calls one function. `opts` carries `args`, `stdin`, `cwd` and `env`. |

A call returns `stdout`, `stderr` and `status`, and the status is the shell function's own: a
tool refusing with `return 3` is telling the runner there is nothing to work on, and that has to
survive the trip.

`meta` separates its fields with a NUL rather than a tab, because a description is prose written
for the router and prose may contain a tab.

## What the bridge does not do

`apply` is not callable through it. `apply` is the only one of the five functions that calls
`confirm`, `confirm` reads `/dev/tty`, and which process owns the terminal once a harness is in
the loop is unsettled.

`confirm` is still defined, because a tool is entitled to assume its runner provides the name.
It prints why it is unavailable and `exit`s rather than returning: no tool tests what `confirm`
returned, since `apply()` in every tool file puts the side effect on the next line, so a
`return` performs the effect the refusal was meant to prevent. The code it leaves is
deliberately none of the ones in [`verbs.md`](verbs.md) — borrowing 7 would tell `lm stats` a
human declined.

## Tests

```bash
node tests/cli.mts            # what `lm` dispatches, and its help
node tests/registry.mts       # the bridge, against bash itself
LM_LIVE=1 node tests/verb-live.mts   # the retry guarantee, against the real model
```

Every case is differential: `libexec/lm-verb` reads the same registry through a sourced subshell, so
while it is here it is the oracle, and a case names the bytes bash produces and requires the
same ones back. A case asserting only that the bridge returned something would pass on a bridge
that dropped a field.

The four `schema matches bash` cases do **not** prove `cwd` is passed through. The test process
already stands in the repository and a child inherits it, so removing `cwd` from the bridge
leaves all four green; the case that tests it runs against a temporary directory. That was found
by perturbing the bridge, not by reading it.

No dependency and no build step: Node strips the types and runs the file. `node --check` is this half of the repository's `bash -n` — run it
on a mutant before believing what the mutant killed, and confirm it rejects a deliberately
broken file first.
