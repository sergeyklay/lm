# Adding a tool

Drop one file into a `tools/` directory. Nothing else changes: the index is the directory
listing. Which directories are listed is the registry, and
[running a verb](verbs.md) fixes that: the repository you are standing in supplies verbs of its
own and the installation supplies the rest, unless `LM_TOOLS` names one directory as the whole of
it. A name the repository also ships resolves to the repository's file.

```bash
name="verb"
description="One line. It is what the router sees."
flags="--force"     # optional. Anything else that looks like a flag is a typo.

collect()  { :; }   # build the prompt from the repository, deterministically
schema()   { :; }   # JSON schema of the answer, enum on every closed set
validate() { :; }   # print one line per violation, nothing when clean
render()   { :; }   # show the result to the human
apply()    { :; }   # perform the side effect
```

A verb is called as `lm <verb> [flags] [text]`, in any order. The runner takes `--dry-run`
for itself and checks every other flag against `flags`, so a typo is refused rather than
read as words. A flag the tool declared arrives as a variable, not as an argument:
`--force` becomes `LM_FORCE=1`. Only text reaches `collect`, and text after `--` is text,
dashes and all.

`lm <verb> --help` is generated from what the file declares — `name`, `description` and `flags` —
so no verb writes a help handler. A declared flag is named there and not described, because the
declaration carries its name and nothing else.

`schema()` is compiled to a GBNF grammar before the model is called, so a shape the
compiler rejects costs the whole request: `HTTP 400 failed to parse grammar`, ahead of any
prefill. Two limits bind every schema, at any depth. A `pattern` opens with `^` and closes
with `$`, and uses no PCRE shorthand: `\d`, `\w` and `\s` all fail, including inside a
character class, so write `[0-9]`. A `maxLength` of 2000 or more fails the same way; 1999
passes. Worse than either is a pattern the compiler neither rejects nor supports:
`^(?=.*z).*$` returns 200 and constrains nothing, so a new `pattern` is worth one throwaway
call before it ships.

`validate` prints violations rather than returning a boolean: the text is fed back to the model for the single retry.

`apply` is the only function that talks to the human, and it does so through two functions the runner provides rather than through the terminal, because the terminal is not always the runner's to read: inside the chat the harness owns it. `confirm "text"` exits 7 when the human refuses. `ask "text"` prints one line of answer, so `labels=$(ask "Labels (bug, ci):")` works; an empty line is an answer and the tool decides what it means, while no answer at all exits 7 like a refused confirmation. Nothing in a tool file reads `/dev/tty` itself, and neither function exists in the four read-only phases, where a question would be asked before the human has approved anything. A tool file that calls one anyway is stopped there and the run exits 1 naming the function, because that is a defect in the tool file and not an answer the human withheld. The wording is the tool's: the runner never composes a question, because it would have to know what a tool's fields mean to ask about them.

A tool refuses with `return 3` when there is nothing to work on. The other codes are the
runner's; [`verbs.md`](verbs.md) lists them.

When `collect()` needs something the machine running the tests may not have, put the call
behind a function so a fixture can replace it. `tools/issue.sh` reads the repository's labels
through `_labels()` for that reason, and the three `issue` cases, which `ls tests/golden/*/*/env`
names, define their own `_labels()` in `env`, so `gh` is never reached and the enum the
case exists to pin is still built. Stubbing the seam beats skipping the case: a skipped case
leaves the verb's most interesting path untested and says so only in passing.

## Tests

```bash
node tests/cli.mts                # what `lm` dispatches, and its help
bash tests/changelog-insert.sh    # the changelog insertion, byte for byte
bash tests/issue-labels.sh        # the label list `issue` hands `gh`, with `gh` stubbed
bash tests/golden.sh              # every verb except the model call
bash tests/ship.sh                # the `lm ship` workflow, on the driver `lm` runs it on
bash tests/stats.sh               # the clean share split at a date and the chat's share of the log
bash tests/consent.sh             # the bounded wait for an answer, under a pty
bash tests/runner.sh              # libexec/lm-verb around the model call, with curl stubbed
node tests/registry.mts           # the Node runner's bridge to a bash tool, and how apply asks
node tests/chat.mts               # which verbs the chat is offered, and the dialog a person answers
node tests/chrome.mts             # what the chat's header, its update notice, status rows and closing block say, and at what width
node tests/request.mts            # what the Node runner asks the model for, off the wire
node tests/chat-request.mts       # what the chat asks the model for, off the wire
node tests/window.mts             # what the declared window buys, off the harness's own compaction
node tests/catalogue.mts          # which models the chat offers, what each declares, and the deadline the launch reads them under
LM_LIVE=1 node tests/verb-live.mts  # the retry, the budget, a verb inside the chat and the shell beside it, on the real model
```

`golden.sh` builds a fixture repository per case and pins what the verb does around the
model: the prompt `collect` writes, the shape `schema` asks for, the violations `validate`
reports and the artefact `render` assembles. `--update` rewrites the expectations; read the
diff before committing them.

Every group of checks below has been made to go red, and that record is what makes a green run of
them worth anything. Of the three mutations of the `--which` logging that `bash -n` accepts, each
kills a different subset of the six cases in `tests/runner.sh`: dropping the trap kills five,
blanking the `which` argument kills three, and dropping the table's exclusion kills one. The
`changelog` internal-symbol check reports nothing over every bullet the changelog has published:
45 when it landed, 47 on 2026-08-26 by
`awk '/^## \[Unreleased\]/{u=1;next} /^## \[/{u=0} !u&&/^- /' CHANGELOG.md | wc -l`, and it names
the internal function the bullet that shipped in `v0.0.2` reached for, which
`git log -S 'formats the command list' -- CHANGELOG.md` locates, while passing the replacement
written by hand to fix it. Naming that function here in back quotes would publish it and turn the
check off, which is why this paragraph does not. The option guard is another: deleting it from
`bin/lm`, a mutation `node --check` accepts, kills four of the six `tests/cli.mts` cases that
cover it and leaves the two asserting only the exit status, because the argument then reaches the
shell runner as a tool name and is refused with 2 there instead. The status was never the
property at risk. The hashes the record carries have a group of their own. Seven mutations of
`log_run` and of the `--which` prompt that `bash -n` accepts were run against the eight cases
covering them, and five discriminate to a single case: hashing a constant kills only the case
that edits `collect`, the empty string in place of `null` kills only the run that never asked, a
length of `0` for a missing answer kills only its own case, dropping the `--which` prompt kills
only that one, and hashing an empty answer rather than nulling it kills only its own. Two are
broad and worth knowing as such: pinning the length to `null` kills both length cases, and
dropping the prompt hash kills four. Every one of the eight has been observed red.
Over the model's own numbers: five mutations that `bash -n` accepts cover the twelve cases holding
them, and the one the task itself
named (feeding the column the wall clock instead of the reply's `total_duration`) turns four
red at once, including the two that read `lm stats`. Replacing the accumulator instead of adding
to it turns exactly the two summing cases red, treating an absent number as zero turns the two
null cases red, averaging the missing in as zero turns only the `lm stats` case red, and pinning
`ms` to zero turns only the case that says the operator's wait is inside it. All twelve have been
observed red. Another covers the two settings that carry the answer budget and stop the model
thinking, which `tests/request.mts` reads off a recording server rather than from a reply.
Neither is in the runner's control flow, so a run without them still succeeds and simply grows
past the budget again: removing the field that names the budget turns two of the four cases red
and leaves the reasoning case green, and removing the reasoning setting turns that one red and
leaves the budget cases green. On the real model the budget is what `tests/verb-live.mts` covers
from the other side, and its three truncation cases were confirmed red both ways: without the
budget field the answer completes and none of the three fires, and without the runner's own
truncation arm the exit code is still 5, from the answer that never arrived, so only the case
reading the message goes red. The code alone cannot tell the two apart, which is why a case
reads the message. What the chat asks for has a group of its own, and part of it
is an absence: `tests/chat-request.mts` reads the request off a recording server through two
instruments, the whole program in print mode and a session on a model a catalogue refresh built.
Twelve mutations that node loads were run against its fourteen cases. Declaring the chat's budget again
turns three red, one per place a budget can be read. Ignoring the card's `thinking` capability, or
declaring the effort field unsupported, each turn four red, the three level cases and the one that
reads what the chat opens at; dropping the map that carries the closed level turns exactly one red,
which is the case the whole declaration exists for; declaring every model thinking turns red the two
cases for a card that claims none, the one asked on a refreshed session and the one that launches
on it. Dropping the verb's own `maxTokens`, which is the regression
this half most risks, turns one red here and five in `tests/request.mts`; ignoring `LM_THINK` turns
red the one case that sets it, and thinking by default turns red the one that does not. Dropping the
seed `bin/lm` writes, so the harness's own default decides again, turns red the one case that
reads what the chat opens at and nothing at all in `tests/chat.mts`; ignoring
`LM_MODEL` turns red the two cases that launch on a card claiming no thinking, and two more in
`tests/chat.mts`. Emptying the
tag list turns five red rather than the one predicted, and the surplus is the finding: with no
catalogue the chat falls back to the single declared entry, so the levels stop reaching the wire as
well as the refresh stopping. The mutant worth keeping is the one that moves the per-model
declaration out of `catalogue()` and applies it at `bin/lm`'s registration instead: the print-mode
case stays green and the three level cases go red, which is the whole reason the second instrument
exists, because print mode never refreshes a catalogue and a fix verified there alone ships a chat
whose own session never sees the declaration. Two cases survived every mutant and are controls
rather than assertions: that the recorder saw a completions request, and that the session opened on
one model. The case reading the refresh is not one of them: it is among the five the emptied tag
list reddens. In `tests/catalogue.mts`, ignoring the capability, forcing
it, and claiming it for a card that could not be read turn red one case each, in that order. Two
cases there stand on the deadline the launch reads the catalogue under, and both are needed:
dropping the signal from `bin/lm`'s call reddens only the case that runs the program against a host
that accepts the connection and never answers, while dropping it from the `fetch` inside
`catalogue()` reddens that one and the in-process case beside it. Neither mutant fails by itself —
both hang — so each case is raced against a timer of its own and reports the timeout as a value,
which is what turns a suite that would never finish into two named failures. In the
status rows, swapping the two right slots back to the layout before them turns four of the
`tests/chrome.mts` cases red — the model's row, the level's, the one reading the second row's grey,
and the empty-slot case — and leaves the case reading the spend on the left green, because that slot
did not move; filling the slot for a model with no level to report turns red that case alone. Over the verbs inside the chat: replacing the registration's walk
over the registry with a filter naming the four tool files leaves every case green except the one
that drops a fifth file in, which is the case that exists for it; making the channel's
confirmation always answer yes *while the run has not asked for the capability* turns the two declining cases in `tests/registry.mts` red, and
three in `tests/chat.mts`, while leaving the approving ones green; and unwiring the channel from the chat's side, so a verb falls
back to the terminal, turns the live case reading exit 7 red while the case asserting nothing was
applied stays green, because a question no one can answer fails the run anyway. Only the pair
distinguishes a refusal the human made from a refusal the plumbing made. Over the
difference between no answer and an empty one: sending an empty line where the channel should
close turns both unanswered cases red and leaves both empty-answer cases green. The first attempt
at that mutation is the warning worth keeping: restoring the swallowed `read` failure in the
bridge crashed the suite with `ERR_STREAM_WRITE_AFTER_END` instead of failing a case, because a
body that had already asked its next question was answered into a pipe the refusal had closed.
That is a mutant that parses and does not run, and it also named a hole in the channel: it now
tolerates being answered after it closes. Another covers the chat's own header and status rows,
where three mutations each redden exactly one case and each was run before it was believed:
guessing the auto-compact label instead of reading the setting reddens the case that asserts an
unread setting prints no mode, right-aligning the branch reddens the case that pins it near the
middle, and dropping the version reddens the case that reads the name.

What the chat installs before it opens, and the row it draws when it did, is a group of its own in
the same suite. The version arithmetic and the message are both pure, so they are pinned off the
network with the registry and npm behind seams a case supplies, and no case reaches either. Two
suites drive the whole program through `bin/lm` and so pay the launch's own request: they point
`npm_config_registry` at a refused port, because `PI_OFFLINE` would also switch off the catalogue
read one of them exists to measure. Without that they install a release into the clone they are
running against, which is how the leak was found. Six
mutations, each predicted by case name before it was planted, each gated by importing the mutated
file on an absolute path, and each confirmed by the value the mutated line produced. Satisfying `*`
instead of the range `package.json` declares reddens five: the three that read the arithmetic and
the two that watch what a launch hands npm, which come back `1.0.0` and `0.85.0` where the range
admits `0.84.4`. Dropping the comparison against the installed version reddens the two cases that
require a launch already on the newest in range to report nothing, and both come back naming the
version they are already on. Rethrowing rather than swallowing reddens exactly the one case that
hands the registry an error, and reddens it as `threw Error: no route to host` rather than by
crashing the suite, because that case awaits a rejection it expects not to get. Of the line itself, six more, driven
by handing `installChrome` a stand-in for the harness that records what it was notified of and what
header it was given. Putting the line back into the header reddens four: the two holding the header
to its two rows, the one requiring it to say nothing about the harness, and an older case requiring
every header row to carry the mark, which a row of text does not - new code killed by a case nobody
wrote for it, and the second entry in this file's record of why a prediction is written down first.
Deleting the notify call reddens the three that read the notice, the version it names and the level
it goes out at, each coming back undefined. Moving the level from `info` to `warning` reddens only
the case that reads the level; adding a restart instruction to the message reddens the case that
reads the message and the one that forbids the word, each leaving the other green, which is what
says the text and its level are pinned apart rather than twice. Dropping the guard on the version
reddens the case requiring a launch that moved nothing to say nothing, which comes back notifying
`harness updated to undefined`, and dropping the guard on the `startup` reason reddens the case
requiring a reload not to repeat it.

The version the harness compares its own release notes against is a settings write rather than a
screen, and its cases carry five mutants of their own. Deleting the write reddens the two that read
what was written, one through a stand-in and one through the harness's own settings file. Dropping
the gate on having installed something reddens the case requiring a launch that installed nothing to
leave the recorded version alone, which comes back writing `null`. Dropping the equality guard
reddens the case refusing a second write and the one reading the file's timestamp back. Replacing
the whole condition with `true` reddens both of those, the case for a machine with nothing recorded,
and the one for a launch that installed nothing. The last two also redden the case that hands the
settings a reader which throws, predicted for neither: removing either guard removes the read, so
the throw never happens and the write goes through. That case pins two properties rather than one,
that the throw is swallowed and that the recorded version is read before anything is written, and
the correction is the third entry in this file's record of why a prediction is written down first.
Making the catch write rather than swallow reddens that case alone. One case here is killed by no
mutant and cannot be: the one requiring the neighbouring setting to survive the write guards the
harness's settings manager rather than any line in this repository, as the case beside it does for
`quietStartup`.

The trap in that series is the anchor for the last of them. `// The chat opens either way.` occurs
twice in `src/chrome.mts`, the second in `silenceStartup`, so a patch taking the first match lands
in code no case in this group reads and reports an empty kill set, which reads as a hole in the
suite. Gating on the occurrence count rather than on the patch's exit status refuses it, and
`grep -c '// The chat opens either way.' src/chrome.mts` returns 2. Counted 2026-08-30 with
`node tests/chrome.mts | grep -c '^ok'` at 110.

What the chat opens thinking at is a settings write and not a flag, so its group is over
`initialSelection` and the seed beside it in `src/selection.mts`. Five mutations, each predicted by
case name before it was planted, each gated by importing the mutated file on an absolute path, and
each confirmed by the value the mutated line produced. Handing `--thinking` over again reddens five
of the group's seven cases in `tests/chat.mts`: the four that read the model flags, which pin the
whole array, and the one that reads that no launch hands a level over. Seeding over a level already saved
reddens exactly the case that saves `high` and reads it back, which comes back `low`. Seeding
nothing reddens exactly the case that reads the seed, which comes back undefined. Seeding `medium`
instead reddens that case and the one in `tests/chat-request.mts` that reads what the chat opens at
off the wire. The fifth is the control worth keeping: `bin/lm` never calling the seed reddens
nothing at all in `tests/chat.mts`, because every case there calls the function itself, and reddens
that same single case in `tests/chat-request.mts`, which comes back `medium`, the harness's own
default. The wiring is held by that one case and by nothing else, and its own gate is
`node --check`, which works on `bin/lm` because `bin/lm` is not a `.mts` file. The trap in the group
is the write: the harness queues it, so a case reading the settings file on the next line reads the
file before it. A launch gets the flush for free from the work it does next; a case has to ask for
it.

The same suite covers the block the chat prints on quitting, over three transcript fixtures in the
harness's own on-disk shape rather than sessions anyone ran: one where three tools run against a
single model, one where two run across a model change, which is the only thing that exercises
the table's second row and the total under it, and one holding a question and no answer, which is a
session that never reached the model and reports nothing. Flipping the one tool result the first fixture
records as failed reddens three cases: the one that reads the counts, and the pair that drives `lm`
on a copy of the fixture through a pseudo-terminal and ends it with an end of input. It leaves green
the case that derives an all-worked session from the same fixture, and that pair is what separates
the count from the form it prints.

Ten mutations of the block in `src/chrome.mts` each redden the set predicted for them before they
were planted. Restoring the withheld failure clause reddens four, among them the two cases that
exist because that clause used to be withheld. Dropping the cached half of a model's input reddens
four, left-aligning the numeric columns reddens seven, and widening every column heading fourfold
reddens those seven and the case that holds the block to eighty columns. Blanking the session
identifier reddens five, printing the resume paragraph for a session with no record to name reddens
only the case that counts the block's paragraphs, and collapsing the sitting to zero reddens four. Three narrow the attribution of a model's
spend: ignoring usage an entry carries rather than a message reddens the two compaction cases,
renaming the model in force before anything has declared one reddens the case that reads `unknown`,
and dropping the declaration entry from the walk reddens the case written for it. That last is the
one worth keeping: planted before that case existed it reddened nothing, because every assistant
record in both fixtures names its own model, and the branch it removes decides only where a
compaction lands before the first reply under a newly declared model. The case was written for the
mutant rather than the other way round.

Two further mutants redden nothing but the pseudo-terminal cases, and nothing else can: refusing the
quit reason and inverting the guard on whether there is a UI both leave every assertion over the
summary green, because a block that is never printed reads exactly like a block that is right until
something reads the terminal back. One more is a control for the procedure rather than for the code:
dropping the cached half of the input from the totals the status row is built from reddens nothing
at all, though the footer read back through the pseudo-terminal shows `↑37.0k` where a clean run
shows `↑40.0k`. Nothing in the suite reads what the status row counts. Of the duration forms,
dropping the round-minute case reddens three: the case written for it and the two that read a whole
number of minutes off the block.

The block carries two elapsed figures, the sitting and the conversation behind it, and six further
mutations separate them. Neutralising the condition for the second row reddens three, and swapping
the two figures reddens the same three: the unit case that reads both rows, and the pair driven
through the pseudo-terminal, which is the only place the two figures differ, because the fixture's
own record is dated before any run of the suite and the sitting is the seconds the case spends in
the chat. Opening the
sitting at the launch whatever the session record says reddens two, the case that pins where a fresh
sitting opens and the one that reads the whole head of the block off the fixture. Reporting the
conversation whether or not the session outlived the launch reddens three, among them the case that
exists because a fresh session prints one row. The sixth is the one worth keeping: opening a
record-less sitting at the first entry, which is what shipped before, was predicted to redden only
the case written for that fallback and reddened three, because a reopened session takes the same
branch; narrowed to leave that branch alone, it reddens the one case and nothing else. A prediction
short of the kill set is the finding, not the disappointment.

The last two lines of the block are a command, and which of the two forms it takes depends on where
the session is kept, so six further mutations separate them. Every case below reads that command;
the ones added with it that read the block's counts instead survive all six. Printing the identifier whatever the
directory says reddens five: the three unit cases holding a session outside the harness's default
session directory, the one that quotes a path a shell would split, and the pair driven through the
pseudo-terminal on a session `--session-dir` put elsewhere. Printing the file whatever the directory
says was predicted to redden four and reddened five, and the surplus is the finding: a file path is
longer than an identifier, so the case holding the block to eighty columns goes red beside them,
which is the whole reason the identifier is the line where it resolves. Dropping the quoting reddens
only the case with a space in the path, and reading a directory the harness will not answer for as
the default one reddens only the case written for it. The last two are aimed at the method that
decides, which the harness ships on the session manager and leaves out of the type it hands an
extension: never calling it reddens exactly the two cases that reopen a session from the harness's
own directory and no unit case at all, which is why that pair is driven through a pseudo-terminal
rather than asserted over `summarize`; negating what it returns reddens all four pseudo-terminal
cases at once, the two locations swapping lines, which is what says the method is answering rather
than merely being present. The series was itself perturbed before it was believed: replanted on an
anchor occurring seven times, the driver refused the mutation rather than patching the first hit,
which is the zero this record would otherwise have had to explain.

The command names `--resume` and prints over two lines in the theme's own grey, and nine further
mutations across `src/chrome.mts` and `bin/lm` separate the three claims in that sentence. Writing
the command as `lm --session` again reddens eight: the five unit cases that read the last paragraph
of the block, the two driven through a pseudo-terminal that read it back off the screen, and the one
counting the resume lines the screen ends on, which comes back 1 because the second line no longer
carries the word. Printing the two lines with no colour on them reddens two, the unit case that
reads the block built with a theme's grey and the pseudo-terminal case that reads the escapes back
off a capture nothing stripped. Not keeping the theme at all, which is the other half of the same
claim, reddens exactly that second one and no unit case, because every unit case hands the block a
colour of its own: the block is written after the harness has stopped the TUI, and the only thing
that can say the header callback kept one for then is a terminal read back with its escapes still
in it. The five cases that hold the block to what it says survive all three, and the case that quits
a session holding a question and no answer survives them too.

Four aim at the translation in `bin/lm` and one at the case it exposed. A guard that matches neither
`--resume` nor `-r` reddens four: the two `tests/cli.mts` cases that read back which session the
harness was asked for, and the two pseudo-terminal cases that reopen a session by the command the
block prints. Handing the identifier over and leaving a copy behind reddens three, the two
pseudo-terminal cases again and the one requiring the reopened chat to have asked the model nothing,
which is the case that would otherwise survive a mutant of the line it was written for: with the
translation gone entirely the picker opens, no chat is reached, and a screen with no error on it
reads exactly like a clean run. Dropping the guard on `--` reddens only the case that reads the
words the chat was handed back off the harness's JSON mode, and the substitution it makes is visible
in the failure - `--session,zzzmarker` where `--resume,zzzmarker` was typed - which is why that case
reads the words rather than asking whether a session was looked up: the harness treats both as text,
so no lookup happens either way. Taking a flag after `--resume` as the name it wanted reddens only
its own case, which reads `--continue` back as the session the harness went looking for.

The fifth is the finding. Reading a missing argument as an empty string was predicted to redden the
case pinning that a bare `--resume` reaches the harness's own list, and reddened nothing: an empty
name is one the harness reads as no session at all, so it opened a new chat and looked nothing up,
which is what that case asserted. Two lines produce the same absence and the case could not say
which. Rewritten to require the picker's own label on the screen, it reddens under the same mutant,
because a translated bare flag opens a chat and draws no picker. The anchor rule earned its place
here too, and by a route the earlier series did not meet: `dim(` occurs twice in `src/chrome.mts`
and both occurrences are on one line, so a gate counting lines reports 1 and passes an anchor a gate
counting occurrences refuses. Replanted there, the mutant meant for the command patched the label
above it and returned the kill set of the colour mutant instead - two cases, a clean-looking kill of
a property nobody was testing.

The harness writes a resume line of its own after that one and the chat drops it as it is written,
so six further mutations aim at the wrap that does the dropping. Never installing the wrap reddens
exactly two, both driven through the pseudo-terminal: the case requiring the harness's line to be
absent, and the one counting the resume lines on the screen, which comes back 2. Never restoring the
original write reddens the two unit cases written for the restore and nothing driven through the
terminal, because the process writes nothing after that line and exits, so only a second line like
it, offered to a sink, says whether the wrap came off; under the mutant that sink still holds the
chunk before it. Reading the chunk without stripping its escapes reddens four, since the harness
dims its label and the line then no longer opens on the words the match is anchored to. Broadening
the match to any chunk carrying `resume` reddens nine: this project's own block is written through
the wrap deliberately, so a match loose enough to take the block takes it, and the eight cases that
read the block off the terminal go red beside the unit case written for that property. The case
counting resume lines survives that one and is worth knowing as coarse, because the harness's line
prints once the wrap has come off on the block and the count is one either way. The fifth is the
finding: dropping the guard that requires a text chunk was predicted to redden only the case that
writes a buffer through the wrap and reddened two, the second being the case after it, which counts
what the sink received and is one short because the throw happened before the buffer got there. That
buffer case reads a throw as a value rather than letting it end the run, which is the whole reason a
mutant crashing where it is planted still has a kill set anyone can attribute. The sixth aims at
where the wrap is installed rather than at what it matches: installing it only once there is a block
to print, which is what shipped before, reddens exactly one, the pseudo-terminal case that quits the
session holding a question and no answer, which counts one resume line on the screen where a clean
run counts none. Every case that reads a block off the terminal stays green under it, and that green
is what says the moved call ran at all.

`node --check` cannot gate a mutant of any module here, and it fails silently. On Node v24.13.0 and v24.14.1 it
exits 0 on a `.mts` file it cannot parse whenever that file carries an `import` or an `export`,
which every module under `src/` and `tests/` does, while the same bytes saved as `.mjs` are
rejected as they should be. The gate that works is an import: `node -e 'import(process.argv[1])'`
on the mutated file throws the `SyntaxError` `--check` swallowed. An ungated mutant that does not
parse reddens every case at once, which is the shape that reads like coverage and demonstrates
nothing, so a gate that never objects is worse here than no gate at all. Give that import an
absolute path: handed `src/chrome.mts` it dies on `Cannot find package 'src'`, which is a gate that
rejects every mutant including the ones that parse, and reads exactly like one that objects for the
right reason.
One group covers the one `apply` whose command line nothing else sees. Every other verb hands its
command what `render` already printed, so the golden fixtures cover it without `git` or `gh` being
called; `issue` assembles a `--label` list from what the human typed, and that list had only ever
been read by eye. Four mutations of `tools/issue.sh` that `bash -n` accepts and that run: dropping
the trim reddens only the case with a space after the comma, reading an empty reply as no labels
reddens only the case that keeps what the model proposed, taking the word `none` literally reddens
only its own case, and removing the confirmation from a run that did not ask for the capability reddens two (the exit code and the absence of
the call), which is the pair worth having, because a verb that creates the issue and then asks is
indistinguishable from one that asks first until the first time someone says no.

Another covers the dialog a person answers, which nothing had ever driven: `tests/registry.mts`
hands `applyAsk` an `Ask` of its own and never enters `src/chat.mts`, while the live case runs in
print mode, where `hasUI` is false and the refusal is the runner's rather than a person's. The
model is a recording server for these, because the subject is the dialog and not the answer. Six
mutations of `src/chat.mts` and `src/registry.mts` that `node --check` accepts and that run, each
confirmed by the dialog or the side effect the mutated line was supposed to produce: showing the
tool's question without the artefact `render` printed above it reddens only the two cases that read
what the human was shown; replacing the dialog with a refusal the chat makes on their behalf
reddens the five approving cases and leaves the declining ones green; dropping the verb's name from
the dialog's label reddens only the case that reads it; the chat no longer saying a refusal
happened reddens only the two cases that read its words; sending an empty line where the channel
should close reddens the three cases that hold no answer apart from an empty one, because the body
then goes on to ask its second question and is answered; and a confirmation that always answers yes
where the capability was not asked for reddens the declining cases here too. The first attempt at these is the warning worth keeping: the
case that cleans up the approved run's artefact removed it without `force`, so a mutant that
suppressed the side effect crashed the suite at that line rather than reddening a case, and a
suite that dies partway prints a plausible run of `ok` lines and proves nothing.

One group covers the one code no page carried. Three sites reach exit 1 and each now has a case
asserting the digit rather than its inequality with zero: the `REFUSE` prelude spending it on a
diagnostic, a body whose command fails, and a body killed before it can return a status. Three
mutations of `src/registry.mts` that `node --check` accepts and that run, each reddening a
different one: `REFUSE` exiting 2 reddens only the read-only case; `apply()` falling back to
`r.status ?? 0` reddens only the killed case and leaves the failing body green, because that
body's status was never null; and dropping `-e` from the shell `apply` runs under reddens the
failing body and its sibling. The negative control is the part worth keeping: written as
`status !== 0`, the read-only case survives `REFUSE` exiting 2 with no failure reported at all,
so an assertion against zero cannot notice a code that changed to another non-zero one.

The sample the clean column withholds itself below has a group of its own. Three mutations of
`libexec/lm-stats` that `bash -n` accepts and that run, each confirmed to have executed by the
column the mutated line printed: lowering the minimum to one reddens only the two-run case, with
`100%` where the case wants `n<14`, and removing the conditional from the `awk` reddens exactly
the same one the same way. Raising the minimum to 999 reddens both that case and the fourteen-run
one, because the marker carries the number it withheld itself under, so both read `n<999`. The
two run-count checks stay green under all three, which is what makes the share the thing being
measured. The fourteen-run case is the positive control, and only the widening mutant reaches
it: without that case the column could withhold every share it is ever asked for and a green run
would report the withholding as correct.

The same column split at a date has a group of its own, and it writes the log by hand rather than
running a verb, because `libexec/lm-stats` reads nothing else. Five mutations of it that `bash -n`
accepts and that run, each confirmed by the row or the message the mutated line printed: swapping
the two periods reddens 6 of the 15 cases and leaves every argument case green; lowering the
minimum to one reddens the 4 that expect a period to withhold itself, printing `100%` over
thirteen runs and `n<1` over none; taking the repository filter off the split reddens exactly 1,
where a record from another repository joins the later period; accepting any `--since` value
reddens the 3 that refuse one, exiting 0 where they want 2; and removing the empty-`LM_LOG` guard
reddens 1.

Two first attempts are the warnings worth keeping, and they fail in opposite directions. The
repository mutation was first planted at an anchor that appears in the table's own query as well,
so it landed there, parsed, ran and killed nothing: zero kills is not a strong suite, it is the
signature of a mutant that never reached the code the cases read. And the empty-`LM_LOG` case first
asserted the exit code alone, which the very next guard produces as well, so removing the guard
under test left the case green - a case that reads a status two lines can produce has to read the
words too, or it cannot tell which line answered.

Which caller a run came from is written by both runners and read by neither, so its group spans
the three suites that hold the record's shape: `tests/runner.sh` for the shell writer,
`tests/chat.mts` for the Node one, and `tests/stats.sh` for a log holding records written on both
sides of the field's arrival. `tests/chat.mts` enters each caller the way it is entered in earnest,
`bin/lm` as a process of its own against the registration the chat itself uses, over a fixture that
refuses in `collect` so neither side reaches a model. Counted 2026-08-29 with `grep -c '^ok'` over
each suite's output: `tests/runner.sh` at 79, `tests/chat.mts` at 31 and `tests/stats.sh` at 26.

Eight mutations, each predicted by case name before it was planted, each gated, and each confirmed
by the value the mutated line put in the record. On the Node side: the chat declaring no caller
reddens 3, giving both callers `cli` and collapsing the case that requires the two records to
differ in that one field; dropping the field from the record reddens 5, which is every case in the
group but the one reading the workflow tag beside it; `runWorkflow` dropping the environment
it is handed reddens only the case run by a workflow; and `callerOf` returning whatever it was given rather
than a member of the set reddens only the case that hands it a name the set does not hold. On the
shell side: the same widening reddens the same one case, dropping `caller` from the `jq` object
reddens 4, and hardcoding `cli` reddens the 2 that expect something else, which is what says the
two callers are pinned apart rather than merely pinned.

The prediction that was wrong is the one worth keeping. Counting only records that carry a caller,
in the table's own query in `libexec/lm-stats`, was predicted to redden the one case reading the
runs column and reddened three: the `awk` reads that column as the denominator of the clean share
too, so an older case pinning the share over a heap died with it. New code killed by a case nobody
wrote for it, which is the second time this file records that shape.

That mutant is also the group's only evidence for its control. `libexec/lm-stats` reads the field
in a block of its own and nowhere in the table, so no mutation of what writes the field can redden
the case that reads a log of both shapes through the table; the inserted filter is what shows the
case could fail at all.

That block has a group of its own, seven cases in `tests/stats.sh` over a log holding all three
shapes at once: a run the chat ran, a run typed at the command line, and a run written before the
field, which names neither. Four mutations of `libexec/lm-stats` that `bash -n` accepts and that
run, each predicted by case name before it was planted and each confirmed by the line the mutated
code printed. Counting the records that name no caller as the command line's reddens exactly the
three cases whose logs hold such a record, printing `4 of 19` where the three-shape case wants
`4 of 10`; dropping the block reddens all seven, including the one that reads the heading; and
printing a share instead of the two counts reddens six, every one but the heading case, printing
`40%` for the same log. The three cases whose logs name a caller on every record stay green under
the first mutation and die under the third, which is what tells the narrowed denominator apart
from the two counts. The control is the clean minimum lowered to one: it reddens the four cases
in the group above that expect a period to withhold its share and leaves all seven of these
green, so what the new cases read is the caller block and not the reader as a whole.

The last group in the live suite covers the shell the chat carries beside the verbs, and its shape
is a concession rather than a preference. Asked plainly to commit, this model reached for the shell
in 4 of 6 sessions measured on 2026-08-27, taking the refusal at its word in the other two, so an
assertion that it goes past would be red about a third of the time with nothing wrong here. What the two arms assert instead is the capability
the page claims: with the shell, `HEAD` moves and no record the log holds accounts for it; with
`--exclude-tools bash`, the same request reaches the verb, stops there and leaves `HEAD` where it
started. Three mutations, each killing exactly one case and each confirmed by the row it printed:
rewording the sentence out of `docs/verbs.md` reddens the case that reads the page; handing the
shell arm `--exclude-tools bash` reddens the case that claims the shell moved `HEAD`; and blanking
`LM_LOG` for the session reddens the case that asserts a record exists. That third one is why the
record count is asserted separately from the records' exit codes: with an empty log the check that
every record is non-zero passes over no records at all, and under the mutation it passed in exactly
that way.

Consent has two groups, because it has two halves. The capability needs no terminal, so
`tests/registry.mts` drives `apply()` with and without it over a tool that both confirms and asks,
and `tests/issue-labels.sh` drives the one tool whose command line depends on what the answer was.
Four mutations, each killing exactly the predicted case names and each leaving every other case in
the suite still reported rather than cut short: the unattended `confirm` refusing reddens 2, its
`ask` answering `y` instead of an empty line reddens 1, `apply` ignoring the flag reddens the same 2
as the first, and `apply` assuming yes for every run reddens the 2 that hold today's refusal down.
The first attempt at the first is the warning worth keeping, and it is the second time this file
records that shape: the case reading the artefact read it without `existsSync`, so the mutant
crashed the suite at that line instead of reddening the case above it, and the kill set came back
one name short of the prediction rather than wrong in a way anyone would notice.

The two affordances are not one thing twice, so `tests/request.mts` drives the seam that reads them
apart from the run that uses it: the flag alone, the variable alone, neither, and a variable set to
something other than `1`. Three mutations, each killing exactly one of them - the seam ignoring the
variable, the seam ignoring the flag, and the flag no longer reaching the tool's own shell.
`lm ship --yes` has cases of its own in `tests/ship.sh`, because a workflow runs its verbs
rather than letting anyone type a flag at them: `parseArgs` in `src/verb.mts` turns the flag into
`LM_YES=1` in the environment `runWorkflow` hands each verb, the way that environment already
carries `LM_WORKFLOW`. Dropping that assignment reddens the one case that counts how many verbs
saw the variable. The mutation that reddens nothing is worth as much - forwarding `--yes` as an
argument to each verb kills no case, because the runner declares that flag and every verb consumes
it rather than refusing it, so the defect this group was first written for cannot happen on this
driver at all. The case asserting the flag was not forwarded went for that reason, and a case that
free text is forwarded took its place.

The bounded wait is the other half, and `tests/consent.sh` cannot afford to wait for it: the bound
is 120 seconds, so its cases take the shipped text of the reading function out of the shell runner
and substitute only the number, which leaves the number itself to cases that grep for it in both
runners. `grep -c '^check ' tests/consent.sh` counts them, at 16 as this is written. The split is
deliberate and it is also a limit worth stating: the shell runner's line is driven under a pty and
the Node runner's is read rather than driven, because the two are built from the same shape and only
one of them is cheap to put a terminal in front of. Five mutations: taking the bound off the shell
read reddens 3, moving the Node constant reddens the 1 that names it, deleting the shell line that
says why the wait ended reddens 1, deleting the Node line that says it reddens 1, and hardcoding a
different bound into the shell read reddens the 2 behaviour cases while the case that greps for the
text survives - which is what shows the text and the behaviour are checked separately rather than
twice. Two harness faults cost more than the five kills. The feeder holding the pty open ended
before the harness did, so the blocked read hit end of input and exited 7 by that route, and a case
reading only the status reported a bound that was not there. And a series killed by the tool's own
wall clock left a mutant in the working tree twice, the second time with `trap ... EXIT INT TERM`
installed, which did not fire: what proves a restore is `cmp` against the pre-series copy in the
same command, never a trap and never the intention to restore.

The registry is a precedence of directories rather than one directory, and the group that pins it
is split across the two runners because the resolution is: `libexec/lm-verb` answers `--list` and
`bin/lm` dispatches, and each resolves for itself. `tests/cli.mts` stands `lm` in five kinds of
directory - a repository with no `tools/` of its own, one shadowing a name the installation ships,
one adding a name it does not, a directory that is no repository at all, and a run with `LM_TOOLS`
set - and `tests/registry.mts` drives `list()` over two directories on its own. Counted 2026-08-30
with `node tests/cli.mts | grep -c '^ok'` at 64 and `node tests/registry.mts | grep -c '^ok'` at 53.

Twelve mutations, each predicted by case name before it was planted and each compared as a name
set. Dropping the project directory from `bin/lm` reddens the six cases that dispatch a verb, run a
workflow or take help from a project file, and none of the listing cases; dropping it from
`libexec/lm-verb` reddens the eight that read the listing or reach a verb through the shell runner,
and none that dispatch. The two sets share exactly one case, the one that asks both runners for the
registry and requires the same answer, which must die whenever either resolver breaks and is the
only case that can say the two agree; every other case belongs to one runner alone, which is what
says the two are pinned apart rather than once. Removing the shell runner's dedup reddens 2,
removing the Node one reddens
3, two of them the workflow's, because `runWorkflow` builds a `Map` from the listing and a repeated
name resolves to the last entry rather than the first. Never marking an entry `project` reddens 3;
never collapsing two identical directories in the shell runner reddens the one case that runs
inside this repository; taking the sort off the shell listing reddens 3; pointing the shell
runner's verb lookup at the installation reddens 2; and letting `LM_TOOLS` be the first of two
rather than the whole registry reddens 2 in each runner.

Three attempts are the warnings worth keeping. `node --check` is not a parse gate for these files:
it accepts a duplicate `const` in any `.mts` carrying an `import`, which is the error that stopped
`tests/cli.mts` loading while it was being written, so what gated every Node mutant here is the
suite printing at least one `ok` line. Reversing the sort in `list()` was predicted to redden one
case and reddened two, the second an older case pinning the order `--help` names tools in - new code
killed by a case nobody wrote for it, and the reason a prediction is worth writing down. And the
mutant that never collapses two identical directories on the Node side kills nothing at all, with
the site confirmed to have executed and to have returned the same directory twice: `list()`
deduplicates by name whatever it is handed, so that collapse is a saved directory read and a shape
shared with the shell runner, not a behaviour. The anchor rule earned its place here too - `DIRS=(`
occurs three times and the first is the `LM_TOOLS` branch, so a patch taken at the first hit would
have measured a branch nobody meant to touch and reported its kill set as the other one's.

The twelve leave part of the group unreddened, and a second series on 2026-08-28 measured which
part. Their kill sets, unioned by case name, cover 20 of the 26 cases the group holds - counted by
differencing the case names the two suites print at `4d345ea` against those they print at
`b069603`. Two of the remaining six were reddened by mutations of `list()` that the twelve never
made: iterating `dirs` in reverse reddens 3 across both suites, one of them the case pinning that a
shadowed name resolves to the nearer file, and reading only the first directory reddens 4,
one of them the case pinning that the installation still supplies the rest. Each set was predicted
by name first and matched. Neither mutant is reachable from the runners, which is why a series
aimed at the resolvers missed both.

The last four are covered by no mutant that is not equivalent, and the guard behind them by no case
at all. Dropping either `[ -n "$TOP" ]` or `[ -d "$TOP/tools" ]` from the `elif` in
`libexec/lm-verb` changes no output anywhere: the mutant lands and the branch flips - `bash -x`
prints a two-element `DIRS` where the intact file prints one - but a directory that is not there
supplies no rows to glob and the `project` marker is a field on a row, so stdout and stderr are
byte-identical, including in the one fixture that isolates the `-d` test, a repository where
`tools` exists as a regular file. An empty kill set under an equivalent mutant indicts neither the
mutant nor the cases. The Node runner's own guard is a different matter: dropping
`!existsSync(project)` from `registry()` in `bin/lm` leaves both suites green at 64 and 53 while
`node bin/lm --help` run inside a repository that has no `tools/` throws `ENOENT` at `lstat` with
`registry` on the stack, because `--list` leaves `bin/lm` for the shell runner before `registry()`
is reached and no case stands the Node runner in such a repository. That is the ordinary case for
anyone who installs `lm` and runs a verb in a project of their own, and it is the group's one real
hole rather than a coarse assertion.

The delivery has a group of its own, and it sits on the driver the operator uses rather than
beside it. `tests/ship.sh` runs `bin/lm ship` into `runWorkflow` over `tools/ship.sh`, with
`commit` and `pr` written as tool files of the suite's own and a recording server answering the one
model call each makes, so every line a delivery runs is run here and none of it needs a GPU.
`grep -c '^check ' tests/ship.sh` counts the cases, at 36 as this is written.

Seventeen mutations beside the two on `--yes` above, each predicted by case name before it was
planted and each compared as a name set. Taking the `git switch -q -c` out of `prepare()` reddens exactly one, the case reading that
`main` is untouched, and not the case reading the branch name: `after_commit` renames whatever
branch is current, so a commit made on `main` still ends up on a branch called after its subject,
and the prediction that the branch cases would die was wrong for that reason. Dropping
`LM_WORKFLOW` from the environment `runWorkflow` builds reddens the two cases that read the
tag and leaves the branch names alone, which is the `:-ship` fallback in `_branch()` working.
Dropping the `--dry-run` guard from the workflow's own `step()` reddens six: the four that read
the repository back after a rehearsal, the one that says a rehearsal stages nothing, and the one
that reads the refusal a rehearsed verb makes on its own account. Its evidence is what the mutant
left behind - a branch renamed to `chore/seed`, after a commit the run never made. Removing the
line that says the workflow's own steps did not run reddens only the case that reads it.

Then one property each: `_name()` returning a constant reddens the case reading the branch name;
cutting the placeholder whether or not `--here` was given reddens the two `--here` cases that read
a branch; never calling `failed_<verb>` reddens the two that read what a refusal left behind;
deleting `git branch -q -D` from `failed_commit` reddens the one that reads the branch list;
removing the `nothing to stage` diagnostic reddens the one that reads it; dropping `git add -A`
reddens the one that reads what an unstaged tree shipped; staging whether or not `--no-stage` was
given reddens both `--no-stage` cases; always taking the staging branch that says nothing reddens
the two that read what got staged; dropping the free text from the arguments each verb is handed
reddens the one that reads it; and dropping the runner's own `--dry-run` guard, in `src/verb.mts`,
reddens the three rehearsal cases that read the commit and the tree.

Three are broad and worth knowing as such: running only the first verb reddens five, the two that
read `pr` and the three that count both verbs; swallowing a verb's non-zero status reddens six,
across the refusal, the `--no-stage` and the rehearsal groups, because every refusal in the suite
travels the same line; and handing every verb `--dry-run` reddens ten, which is what covers the
cases saying the commit landed and `pr` ran.

Two first attempts are the warnings worth keeping, and both are cases too coarse for the mutant
written for them. The rehearsal case reading `git status --porcelain` first ran on a fixture whose
tree was already staged, so the mutation that lets `prepare()` stage changed nothing it could see
and the kill set came back one name short; the fixture now carries a file staged and modified again
on top of that, and an untracked one beside it. And the `--no-stage` case first read the index
alone, which is empty both when nothing was staged and when what was staged has just been
committed, so the mutation that always stages left it green; it reads the working tree now.

Five cases no mutation reddens, and they are controls rather than assertions: that a refusal leaves
no commit, with and without `--here`; that the work is still staged after one; that a rehearsal
exits 0; and that it still prints what `commit` would do. Each holds an absence or a completion
that no mutation of the workflow can manufacture on its own.

`shellcheck tools/*.sh` cannot be brought to silence, and the count is the check rather than a
defect to fix. Every tool reports exactly three: `SC2148` because it carries no shebang, which
is honest (`libexec/lm-verb` sources it and never executes it), and `SC2034` twice, for `name` and
`description`, which the runner reads after sourcing and the file itself never uses. Measured
2026-08-26 across the four tools with
`for f in tools/*.sh; do shellcheck -f gcc "$f" | wc -l; done`: four, three, three, three. A
tool reporting a fourth carries something the others do not, and that is what to look at.

`changelog` is the one, and its fourth is a false positive worth leaving. Its validator matches
the backticked spans in a drafted bullet, so the regex contains literal backticks inside single
quotes, and `SC2016` reads those as a command substitution that will not expand. Quoting it any
other way changes what the pattern matches. `shellcheck -f gcc tools/changelog.sh` names the
line.
