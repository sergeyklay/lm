# The runner

`lm` is the only command. With no arguments it opens a chat against the local model; with a verb
it runs that verb; `lm ship` and `lm stats` reach the composition and the run log. Everything it
dispatches to lives in `libexec/`, which is not on anyone's `PATH`.

`lm --help` is written by `lm` itself and lists everything it dispatches, because the shell
runner it hands a verb to knows nothing about the chat, `ship` or `stats`. A name in the first
position claims the flag: `lm commit --help` is a question about `commit` and is answered from what
that file declares, while `lm --help` is a question about `lm`. Nothing in a tool file answers
`--help`, and nothing has to.

`lm` claims four options in the first position: `--list` and `--which`, which are the shell
runner's and pass through to it, and `-h` and `--help`, which it answers itself. `--dry-run` and
`--yes` belong to a verb and go after it, and leading one of them is refused by name and told
where the flag goes, because the harness that would read it there has never heard of a verb to
put it behind. Anything else that starts with a dash is the chat's and reaches it unread, so
every flag the harness takes is available from `lm` without this file naming one of them, and a
flag neither side takes is refused by name by the harness that parses it, before a session opens.

The chat is the harness's own interactive mode, driven through its entry point with an inline
extension that registers the local provider from `LM_OLLAMA`, `LM_MODEL` and `LM_CTX`, and every
verb in the registry beside it. The chat offers every model ollama has, and opens on the one the
operator saved inside it, falling back to `LM_MODEL` when they have saved none. A model chosen
through `/model` and kept with Ctrl+S is an explicit choice, and `findInitialModel` in the
harness reads it from the settings file whenever no `--model` reaches `main()` ahead of it, so
`bin/lm` hands the flag over only when there is nothing saved to overrule. The list itself:
the extension hands the harness a `refreshModels` function, which the harness calls in the
background once at startup and again whenever `/model` opens, and which reads the names from
`/api/tags` and each card from `/api/show`. Each model declares the smaller of its card's own
context length and `LM_CTX`, because the service bounds every model it loads and a card smaller
than that bounds itself; a model under the floor in `docs/verbs.md` arms compaction on every turn
and summarises nothing, which is that model's limit rather than a setting. Nothing is cached: the
list costs two round trips to a service on the same machine, and a cached one would outlive an
`ollama rm`. An ollama that cannot be reached, one that accepts the connection and stays
silent past the deadline in `docs/verbs.md`, and `PI_OFFLINE`, all leave the chat on the single
model it opened with, because the harness replaces the offered list only when a refresh returns
one. A verb offered that way takes what a human types (free text and
`--dry-run`) and nothing about its own answer: it still writes its own prompt from the
repository and asks the model itself, so what it commits is what `lm commit` commits, at the cost
of the chat's own call to choose it. Its questions reach the chat's dialogs rather than the
terminal, and a mode with no dialog to show, such as the harness's print mode, refuses on the
human's behalf and applies nothing.

A chat turn asks the model for no answer budget. `LM_MAX_TOKENS` is a verb's number and reaches
nothing here: the field the harness would carry it in on this route is `max_completion_tokens`, which
ollama discards, and what does bound a turn is the window it accounts against, with the person
watching the answer arrive beside it. A budget that did reach the model would be spent on its
thinking before its answer, and a turn that ran out of one would lose the answer rather than shorten
it, because the harness reads a truncated reply as something to compact and retry.

The thinking channel is the harness's own `/thinking`, and it works here because the registration
tells the truth about each model. `/api/show` answers with a `capabilities` array beside the
`model_info` the window is read from, so `catalogue()` declares a model as thinking exactly when its
own card advertises it, at no request that was not already being made. A model the card calls
thinking is offered the harness's five levels; one it does not is offered `off` alone and is asked
for no effort at all.

Those levels reach ollama as `reasoning_effort`, under their own names, except the one that reads
as closed: `off` sends no field, and no field is the state this model thinks in, so the
registration maps `off` to `none`, which is the only form measured to close the channel on `/v1`.
The chat opens at `low` rather than at `off`, because the chat is where a person thinks with the
model, and one notch below the harness's own default because the levels above it buy no more
reasoning on this model than the one below. A verb is batch and asks for `none` unless `LM_THINK`
says otherwise.
The second status row shows the level the session is at, and shows nothing for a model that has no
level to report.

The catalogue is read once before the session opens as well as at the refresh the harness runs
after it. A session keeps the model object it opened on, and no refresh replaces it, so a
declaration that only the refresh produced would be a declaration the operator's own session never
sees: it would reach the model selector and not the request. `PI_OFFLINE` switches that first read
off exactly as it switches the refresh off.

The chat keeps its settings, its credentials and its session history in the harness's own
directory under the home directory, outside this repository, and writes there as you use it. One
of those settings it writes itself, once: the harness lists every resource it loaded on each
launch unless `quietStartup` is set, and there is no flag for it, so the chat sets it and says
nothing, because a message about a setting you did not ask for is the noise it removes. A value
already there is left alone. A past session is reopened from `lm` itself rather than from a
subcommand: `lm --continue` takes the most recent one, `lm --resume` offers the list to choose
from, and `lm --session` names one by file or by identifier.

It wears this project's own header and status rows rather than the harness's. The header is the
mark, the name and the version `package.json` declares, and one dim row naming what to type; the
status rows carry the working directory, the branch when there is one and the model, then the
context against its window, what the session has spent beside it, and the thinking level the
session is at. Both are installed on `session_start`,
because the harness builds its own header before extensions load and replacing it earlier is a
no-op, and both are drawn from the harness's theme rather than from colours of their own, so a
terminal without truecolor gets the theme's approximation. The harness restores its own header
and footer while it tears the extension UI down, so the last frame you see on quitting is its,
not this one's.

Quitting then prints a block of what the session did: the session's identifier, how many tools it
ran and how many of those failed, how long the sitting lasted under `Time`, and a table of what each
model was asked and what it spent, one row per model with a total row under them when more than one
answered. `Time` is this sitting alone, from the moment the session opened in this launch to the
moment you quit. A session whose own record was written before this launch started is one you
reopened, and a second row, `History`, carries the whole conversation's span, from that record to
the newest entry in it. The condition for that row is exact rather than a threshold and compares no
durations, so a session opened fresh prints `Time` and nothing else. The launch is the process's own
start rather than the first `session_start` event: the harness fires that again for a reload, and
rebuilds this extension with it, while the chat carries on. A session the launch itself creates, at
startup or through `/new`, has a record younger than the process, so its sitting opens at that
record and no `History` row is printed for it. Every figure is a count, and none is divided by
another, because a share below this project's stated minimum sample is withheld and one session is
never that sample. A count of zero is printed rather than withheld, so a session that ran no tool
says `0 ran, 0 failed`: a zero you cannot see cannot be told apart from a figure nothing computes.
The last line is the command that reopens the session, in the form `lm` itself takes, and which of the
two forms it takes depends on where the session is kept. An identifier resolves against the harness's
default session directory and nowhere else, so a session held there is named by its identifier, which
is short and is the same string the row at the top of the block already showed. A session held
anywhere else, which is what `--session-dir` produces, is named by its file instead, because that path
reopens the session from wherever it is while the identifier would not find it at all. A directory the
harness declines to answer for takes the file too: the file is right in both cases and the identifier
in only one. A path a shell would read as more than one word is quoted, and a long one is the single
row of the block that can run past eighty columns, which is what the identifier buys where it works. A
session that
never reached the model prints nothing at all, since nothing was asked and nothing was answered. The
block is written on `session_shutdown`, which also fires for a reload and for each of the three ways
a session is replaced, so only the quit reason prints one. By then the harness has stopped the TUI,
so the block lands on the restored terminal, immediately above the harness's own resume command.

`libexec/lm-verb` is the shell runner and still runs every verb. The Node side under `src/` is
the half being built to replace it, and it reads the same registry, so a tool file does not know
which one called it. Each resolves that registry for itself, which is why `tests/cli.mts` asks
both for it from the same directory and requires the same answer. A verb reads none of that directory: the Node runner hands the harness
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
| `list(dirs)` | The index: the `*.sh` files in each of `dirs`, nearest first, each name once, sorted. Adding a tool changes no file here. |
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
