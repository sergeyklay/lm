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
extension that registers the local provider from `LM_OLLAMA`, `LM_MODEL`, `LM_CTX` and `LM_MAX_TOKENS`, and every
verb in the registry beside it. A verb offered that way takes what a human types (free text and
`--dry-run`) and nothing about its own answer: it still writes its own prompt from the
repository and asks the model itself, so what it commits is what `lm commit` commits, at the cost
of the chat's own call to choose it. Its questions reach the chat's dialogs rather than the
terminal, and a mode with no dialog to show, such as the harness's print mode, refuses on the
human's behalf and applies nothing.

The chat keeps its settings, its credentials and its session history in the harness's own
directory under the home directory, outside this repository, and writes there as you use it. One
of those settings it writes itself, once: the harness lists every resource it loaded on each
launch unless `quietStartup` is set, and there is no flag for it, so the chat sets it and says
nothing, because a message about a setting you did not ask for is the noise it removes. A value
already there is left alone.

It wears this project's own header and status rows rather than the harness's. The header is the
mark, the name and the version `package.json` declares, and one dim row naming what to type; the
status rows carry the working directory, the branch when there is one and what the session has
spent, then the context against its window and the model. Both are installed on `session_start`,
because the harness builds its own header before extensions load and replacing it earlier is a
no-op, and both are drawn from the harness's theme rather than from colours of their own, so a
terminal without truecolor gets the theme's approximation. The harness restores its own header
and footer while it tears the extension UI down, so the last frame you see on quitting is its,
not this one's.

`libexec/lm-verb` is the shell runner and still runs every verb. The Node side under `src/` is
the half being built to replace it, and it reads the same registry, so a tool file does not know
which one called it. A verb reads none of that directory: the Node runner hands the harness
settings of its own with the automatic retry and the compact-and-retry both off, so a verb costs
the one model call the record reports, or the two a validator's rejection buys, and never a
number that depends on a file outside the repository.

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
| `apply(file, opts)` | The side effect, for a caller that owns the terminal. Returns the status. |
| `applyAsk(file, opts, ask)` | The side effect for a caller that does not: the status and everything the body wrote. |

A call returns `stdout`, `stderr` and `status`, and the status is the shell function's own: a
tool refusing with `return 3` is telling the runner there is nothing to work on, and that has to
survive the trip.

`meta` separates its fields with a NUL rather than a tab, because a description is prose written
for the router and prose may contain a tab.

## How apply differs

`apply` is the only function with a side effect and the only one that talks to the human, so it
does not go through the same call as the read-only phases. It runs under `set -euo pipefail`,
because a body that fails halfway must not carry on and report success, and it reads the model's
answer on stdin like `render` does.

Where its questions go is the caller's to decide, and the caller is either the command line or the
chat. On the command line `apply` inherits the terminal and `confirm` and `ask` read `/dev/tty`.
Inside the chat the harness owns the terminal, so `applyAsk` gives the tool a pair of file
descriptors instead: the question goes out on one with the wording the tool file gave it and one
line of answer comes back on the other. No answer at all is a refusal and exits 7, whichever
function asked: a human who closed the dialog decided nothing, and a channel deciding on their
behalf is what this shape exists to avoid. An empty line is an answer, and what it means belongs to
the tool: `lm issue` reads it as keeping the labels it proposed. Everything the body writes comes
back to the caller in the chat and is simply inherited on the command line.

`confirm` and `ask` are defined in the read-only phases too, because a tool is entitled to
assume its runner provides the names. There they print why they are unavailable and `exit` rather
than returning: no tool tests what `confirm` returned, since `apply()` in every tool file puts
the side effect on the next line, so a `return` performs the effect the refusal was meant to
prevent. The code they leave is deliberately none of the ones in [`verbs.md`](verbs.md):
borrowing 7 would tell `lm stats` a human declined.

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

There is one `schema matches bash` case per tool file, and none of them proves `cwd` is passed
through. The test process already stands in the repository and a child inherits it, so removing
`cwd` from the bridge leaves every one of them green; the case that tests it runs against a
temporary directory. That was found by perturbing the bridge, not by reading it.

No dependency and no build step: Node strips the types and runs the file. `node --check` is this
half of the repository's `bash -n`: run it on a mutant before believing what the mutant killed,
and confirm it rejects a deliberately
broken file first.
