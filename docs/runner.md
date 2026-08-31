# The runner

`lm` is the only command. With no arguments it opens a chat against the local model; with a verb
it runs that verb; `lm ship` and `lm stats` reach the workflow and the run log. Everything it
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
put it behind. Anything else that starts with a dash is the chat's, so
every flag the harness takes is available from `lm` without this file naming one of them, and a
flag neither side takes is refused by name by the harness that parses it, before a session opens.
One word of that is read on the way past rather than only forwarded: `--resume` and `-r`, whose
argument goes over as `--session`, because reopening a chat is what the closing block tells the
operator to type and the harness spells the naming and the choosing as two different flags.

The chat is the harness's own interactive mode, driven through its entry point with an inline
extension that registers the local provider from `LM_OLLAMA`, `LM_MODEL` and `LM_CTX`, and every
verb in the registry beside it. The chat offers every model ollama has, and opens on the one the
operator saved inside it, falling back to `LM_MODEL` when they have saved none. A model chosen
through `/model` and kept with Ctrl+S is an explicit choice, and `findInitialModel` in the
harness reads it from the settings file whenever no `--model` reaches `main()` ahead of it, so
`bin/lm` hands the flag over only when there is nothing saved to overrule. A choice made any other
way lasts the session and no longer, so the status row marks a model that will not come back:
`session only · Ctrl+S` follows the name. A model that will come back carries nothing, because that
is what the operator expects to have, and it is the saved choice where there is one and `LM_MODEL`
where there is none. The settings file is read on the way in and again on every model change, and
the keystroke fires that event too, so keeping a choice clears the mark where it stands. The list
itself:
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
reasoning on this model than the one below. That level is a seed and not a flag: `--thinking` beats
every level the harness has saved, both its global default and the per-model one, and `bin/lm` has
resolved no model when it builds its flags, so it cannot know which per-model entry a launch would
land on. It writes `low` into the harness's settings as the global default when none is saved there
and hands no `--thinking` over at all. So a level chosen through `/thinking` and kept survives every
later launch, and the order that decides one is the harness's own: the level saved for the model in
force, then the global default. A card that claims no thinking is clamped to `off` whatever is
saved. A verb is batch and asks for `none` unless `LM_THINK` says otherwise.
The second status row shows the level the session is at, and shows nothing for a model that has no
level to report.

The catalogue is read once before the session opens as well as at the refresh the harness runs
after it. A session keeps the model object it opened on, and no refresh replaces it, so a
declaration that only the refresh produced would be a declaration the operator's own session never
sees: it would reach the model selector and not the request. `PI_OFFLINE` switches that first read
off exactly as it switches the refresh off.

The chat never advertises its own updates, and never needs to, because it installs them itself
before the harness is imported. The harness carries a version check of its own that draws a banner
above the prompt naming a command to run, and `bin/lm` sets `PI_SKIP_VERSION_CHECK` to retire it: a
variable the program sets travels with the clone, where a settings key would have to be put on every
machine by hand. In its place the launch reads the range `package.json` declares for the harness,
asks npm's own configured registry which versions exist, so an operator on a private one is asked
the same registry npm will install from, and takes the newest that range admits. `^0.84.3`
carries every `0.84.x` by itself; the move to `0.85` is a commit, because that is the move that can
break the extension this project registers. When the version it picks is the one already installed,
nothing is installed and nothing is said. Otherwise npm installs it into this clone alone, under
`--no-save`, which leaves `package.json` and `package-lock.json` byte for byte as they were, so the
operator's working tree stays clean and the range still says what the operator wrote. Because it
lands before the harness is imported, the session opens on the new version and no restart is asked
for. The launch says so through the harness's own notice rather than through this project's header,
at the `info` level, which prints the line dim and bare where the other two prefix it with a word
claiming something is wrong. The header is what the screen says on every frame and an update
happened once, so the line is a system message and not a row of chrome. A launch that moved nothing
says nothing, and a reload, which installs nothing, does not repeat it.

Only the chat pays for any of this. A verb makes no registry request and no version check, so
`lm commit` costs what it always did. The one request the launch does make is bounded at two
seconds, as the catalogue read beside it is, and asks for the abbreviated packument rather than the
whole document. Measured on 2026-08-29: 66822 bytes against 232475, and 113 ms cold then 32 ms warm
over five requests. `curl -s -H 'accept: application/vnd.npm.install-v1+json'
https://registry.npmjs.org/@earendil-works%2fpi-coding-agent | wc -c` re-derives the first size, and
the same command without the header the second. The install that may follow is not bounded, because
killing npm part way through leaves a half-written package tree nothing here could repair, and it
is paid once per release rather than once per launch. Every other way this can go wrong is silent:
no network, no npm, an install directory nothing may write to, a registry that answers slowly or
with rubbish, each leaves the chat opening on the version already installed with nothing printed,
because an update that did not happen is not news. `PI_OFFLINE` switches the request off entirely,
as it switches the catalogue read off.

The one thing this leaves for the operator is `npm ci`, which reinstalls from the lock and so puts
the harness back to the version the lock names. The next launch installs the newest in range again.

The chat keeps its settings, its credentials and its session history in the harness's own
directory under the home directory, outside this repository, and writes there as you use it. Three
of those settings it writes itself, once each and silently, because a message about a setting you
did not ask for is the noise it removes: the harness lists every resource it loaded on each launch
unless `quietStartup` is set and there is no flag for it, the thinking level above is the second,
and the version the harness compares its own release notes against is the third. A value already
there is left alone in all three. The last is written only on the launch that installed a new
harness, because that launch is what would otherwise earn the greeting: the harness shows the notes
lying between the version it finds recorded and the one it is running, and an update nobody asked
for should not cost a screen of them on the way in. `/changelog` still shows them on request, a
harness that moved some other way keeps the greeting it earned, and a machine with nothing recorded
is left to the harness, which records its own version there, shows nothing, and reports the install
while it does. A past session is reopened from `lm` itself rather than from a
subcommand: `lm --continue` takes the most recent one, and `lm --resume`, or `-r`, takes the
identifier or the file the closing block printed, or offers the list to choose from when nothing
follows it. The harness spells those two apart, taking a name on `--session` and nothing at all on
its own `--resume`, so `lm` hands a name over as the first and leaves the bare flag as the second.
A flag after `--resume` is a flag rather than the name it wanted, and everything after `--` stays
text, dashes and all. Untranslated, a name there is a word the harness has no flag for, and it
would reach the reopened chat as the first thing it was asked.

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

Quitting then prints a block of what the session did, drawn inside one frame with a column of
padding inside it and set out in three headed sections. `Summary` carries the session's identifier,
how many tools it ran and how many of those failed, and how long the sitting lasted under `Time`.
`Spend` carries a table of what each model was asked and what it spent, one row per model under a
header row and a rule, with a total row under them when more than one answered. `Resume` carries the
command that reopens the session. The headings are bold, the command is in the theme's accent and
the frame and the rule are in its border colour, while every figure between them is left uncoloured,
because a colour on a count is a claim about the count. The value column is one column across the
first two sections, so the figures beside `Session` and the model names begin in the same place; it
gives way only where holding it would leave the identifier beside `Session` no room, which an
identifier elided to fit the table can do. The block is as wide as the terminal says it is,
read from `process.stdout.columns` at the moment it is written, so a two-hundred-column
terminal gets two hundred. Where there is no terminal to ask, which is what a pipe, a
redirect and CI are, and what a pseudo-terminal nobody gave a size to reports as a zero,
the width falls back to eighty; under twenty it is floored at twenty, the floor the harness
puts under its own width, because a command broken any finer comes out a character
to the row. The frame costs six of those columns, two for its sides and four for the padding, and
everything inside it is sized against what it leaves rather than against the terminal, or a row
would cross the border it was drawn to sit inside. It is drawn only where the terminal can hold it:
its interior has to clear that same floor of twenty, and every row has to fit that interior, which
an identifier and the table's four counted columns cannot always be made to do. A terminal that
fails either test is given the block without a frame, which is what it looked like before there was
one. Every column of the table but the model's is already as wide as its own widest cell, so
what the width decides is the room that column is left and how often the command that reopens the
session has to break. In the table the four counted columns are as wide as the widest cell in them
and the model column takes whatever they leave, so an identifier wider than that is elided in its
middle rather than cut off at the end: names run out to
a quantization suffix reach 54 characters, which `printf %s
'hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M' | wc -c` returns, and the head is what
tells one family of models apart while the tail is what tells two quantizations of one family apart,
so a cut from either end would leave two rows reading the same. `Time` is this sitting alone, from
the moment the session opened in this launch to the moment you quit. A session whose own record was
written before this launch started is one you reopened, and a second row, `History`, carries the
whole conversation's span, from that record to the newest entry in it. The condition for that row is
exact rather than a threshold and compares no durations, so a session opened fresh prints `Time` and
nothing else. The launch is the process's own start rather than the first `session_start` event: the
harness fires that again for a reload, and rebuilds this extension with it, while the chat carries
on. A session the launch itself creates, at startup or through `/new`, has a record younger than the
process, so its sitting opens at that record and no `History` row is printed for it. Every figure is
a count, and none is divided by another, because a share below this project's stated minimum sample
is withheld and one session is never that sample. A count of zero is printed rather than withheld,
so a session that ran no tool says `0 ran, 0 failed`: a zero you cannot see cannot be told apart
from a figure nothing computes. The block closes on the `Resume` heading and the command itself,
the command in the theme's accent rather than in the dimmest ink on the screen, because it is the
one row here that leaves the screen for a shell. The block is written once the harness has stopped
the TUI, where the theme a header or footer callback is handed is out of scope, so the header
callback keeps the bold, the accent and the border colour for then, and the block
goes out as plain text when no header was ever drawn. Which of the two forms the
command takes depends on where the session is kept. An identifier resolves against
the harness's default session directory and nowhere else, so a session held there is
named by its identifier, which is short and is the same string the row at the top of
the block already showed. A session held anywhere else, which is what `--session-dir`
produces, is named by its file instead, because that path reopens the session from wherever it is
while the identifier would not find it at all. A directory the harness declines to answer for takes
the file too: the file is right in both cases and the identifier in only one. A path a shell would
read as more than one word is quoted. Nothing else about the command is shortened, because a path
that no longer opens the session costs the operator more than a ragged screen does, and no
shortening would bound the row anyway: the harness names every session file after a timestamp and a
UUID, so the basename alone is 67 columns before any directory in front of it, which `printf %s
'2026-08-28T20-00-00-000Z_01a04900-0000-7000-8000-00000000c0de.jsonl' | wc -c` returns. A command
wider than the block is broken across rows with the shell's own line continuation instead, and a
paste rejoins exactly the word that was printed. It is the one row of the block that leaves the
screen for a shell, so a terminal wide enough to hold it whole leaves nothing to rejoin at all. Each
piece is quoted on its own rather than the whole command being quoted around the break, because a
backslash inside single quotes is a backslash and not a break. A session that never reached the
model prints nothing at all, since nothing was asked and nothing was answered. The block is written
on `session_shutdown`, which also fires for a reload and for each of the three ways a session is
replaced, so only the quit reason prints one. By then the harness has stopped the TUI, so the block
lands on the restored terminal.

The harness writes a resume line of its own straight after that, saying what the block already said
under the name of whichever program it was installed as, and it offers no way to switch that off: no
event fires after `session_shutdown`, and neither the line's formatter nor the shutdown path that
writes it is exported. So the handler wraps `process.stdout.write` the moment it sees the quit,
before it has built the block and whether or not there will be one to print, drops the one chunk
whose text opens `To resume this session:` and puts the original write back on that same chunk. The
block is written through the wrap on purpose, because that is what holds the match to the harness's
line: this project's own `Resume` heading opens on the same word, and a match loose enough to take
it would swallow the block instead. Escape sequences are stripped before the text is read, since the
harness dims its label.

This rests on wording that is the harness's to change, and it degrades to what it replaced rather
than to anything worse. A line that no longer opens that way is matched by nothing, so the wrap stays
in place until the process exits a moment later, nothing else is dropped, and you see the duplicate
line again. `tests/chrome.mts` drives the chat through a pseudo-terminal and requires that line to be
absent, so a harness that changes its mind reddens a case here rather than reaching you.

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

No dependency and no build step: Node strips the types and runs the file. A mutant of one still
has to be gated before anything it killed is believed, and the gate is an import rather than
`node --check`, which exits 0 on a `.mts` file it cannot parse; [`tools.md`](tools.md) carries the
command and the measurement behind it.
