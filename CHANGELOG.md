# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The chat keeps the harness it runs on up to date by itself, and no longer shows the harness's own `Update Available` banner above the prompt telling you to run a command of another program's. Every launch reads the range `package.json` declares for the harness, asks the npm registry which versions exist, and installs the newest that range admits into your clone before the session opens, so the chat starts on the new version and there is nothing to restart. `^0.84.3` therefore carries every `0.84.x` release by itself, while a move to `0.85` still needs a commit here, because that is the move that can break the chat's own extension. Nothing is written to `package.json` or `package-lock.json`, so your working tree stays clean and the range keeps saying what you wrote; running `npm ci` afterwards puts the harness back to the version the lock names, and the next launch moves it forward again. The launch says which version it moved to in one dim line under the header, as a system message rather than as a row of the chat's own chrome, and a launch that moved nothing says nothing: no network, no npm, an install directory nothing may write to and a registry answering slowly or with rubbish all leave the chat opening on the version already installed, saying nothing at all. `PI_OFFLINE` switches the request off entirely. The release notes the new harness brings do not greet you either. The harness shows the notes lying between the version it finds recorded and the one it is running, and the chat records the version on the launch that installed it, so an update you did not ask for costs you no screen of another program's notes on the way in; `/changelog` still shows them when you want them, and a harness that moved some other way keeps the greeting it earned.

- `lm stats` now says how much of the run log the chat produced: a block under the workflow one, reading `N of M`, where `N` is the runs the chat ran and `M` is the runs whose record names a caller at all. That denominator is narrower than every other count the reader prints, and deliberately so: a record written before the `caller` field names no caller, and a run that does not say is not a run from the command line, so counting it as one would report a chat that had run almost nothing where what the log holds is mostly records older than the field. A log entirely older than it reports `0 of 0`. It is two counts and never a share, and `--since` still splits the clean column alone, so the block reads the whole log exactly as the counts beside it do.

- Every run now records which caller ran the verb, under `caller`: `cli` when you ran it yourself and `chat` when the chat ran it for you, so the log tells a verb you typed apart from one a chat session ran on your behalf and the rates `lm stats` prints stop being ambiguous the moment you start working in the chat. It sits beside `workflow` rather than inside it, so a delivery records both the workflow a run belonged to and who asked for the delivery, and a run that belongs to no composition still says who asked for it. The set is closed and the command line is the base case: a caller that is not a person at a prompt names itself in `LM_CALLER` before it runs `lm`, and a name the set does not hold is recorded as `cli`. Records written before the field carry no `caller` at all, and `lm stats` reads them beside the rest.

- A past chat is reopened from `lm` itself: `lm --resume <file or id>`, or `-r`, names one outright, `lm --resume` with nothing after it offers the list to choose from, and `lm --continue` takes the most recent one. A flag after `--resume` is a flag rather than the name it wanted, and everything after `--` is still text, dashes and all. `lm` claims `--list`, `--which`, `-h` and `--help` in the first position and hands every leading flag but a verb's own two to the chat, reading only `--resume` on the way past, so every session flag the harness takes is available without this repository keeping a list of them in step with it. Before, each of these had to be typed as `lm chat --resume` and the shorter form was refused as an option `lm` does not take.

### Changed

- The chat's closing summary now takes the width of the terminal it is written to, so a wide terminal gets a wide block and a pipe, a redirect or a terminal that reports no size falls back to eighty columns, floored at twenty.
- A resume command wider than the block is now broken across rows with the shell's own line continuation, each piece quoted on its own, so a paste rejoins exactly the path that was printed rather than the command being shortened.
- A model identifier wider than the spend table allows is now elided in its middle rather than cut off, so two quantizations of one model family stay told apart by their tails.
- The registry is now the `tools/` of the repository you are standing in and nothing else: `lm` run in a project that ships no `tools/`, or outside a repository, has no verbs at all rather than falling back to the installation's own, and `LM_TOOLS` still names the whole registry when set.
- With an empty registry `lm --list` prints nothing and exits 0, `lm --help` prints neither `Available verbs:` nor `Available workflows:` and no line pointing at a per-tool `--help`, and a name that is not there is refused as `lm: no such tool '<name>'.` with no list under it.
- `lm --which` now refuses before it asks the model when the registry is empty, saying `lm: the registry is empty, so no verb can serve that request` and exiting 2, so a request the model never saw is not logged as a refusal.
- `lm --list` no longer prints a third `project` field marking entries the repository supplied, because there is no second directory to mark them against; every entry prints the same two tab-separated fields.
- The registry's second kind is a workflow everywhere rather than a composition in the code and a workflow on the screen. `lm --help` names verbs and workflows and nothing else, `lm --list` and `lm --which` answer for both kinds under those words, `lm stats` reads `runs from a workflow:`, the variable a workflow exports to the verbs it runs is `LM_WORKFLOW`, and the run record names the workflow a run belonged to in `workflow`. A record written before this carries that name as `composition` and `lm stats` reads either, so every run already logged under the old name is still counted. What marks a file as a workflow is unchanged, because it is the `verbs` it declares, and so is `$LM_TOOLS` and the directory it names, because `tool` stays this project's word for a file in the registry whichever kind it is.

- The chat's closing summary is now a block rather than one line: the session's identifier, how many tools ran and how many of those failed, how long the sitting you just had lasted, a table of what each model was asked and what it spent in input, cache and output tokens — one row per model, with a total under them when more than one answered — and the command that reopens it, on two lines and in the grey the status row spends on the thinking level, which names the session by its identifier when it is held where the harness keeps its own sessions and by its file when it is not, since an identifier resolves in that one directory while a file reopens the session from wherever it is. That command is now the only resume line on the screen: the harness prints one of its own directly under the block, saying the same thing a second time and under the name of whichever program it was installed as, and the chat drops that one write as it is made and puts the terminal back the way it found it immediately afterwards. The drop is set up on every quit rather than only on one with a block to print, so a session that never reached the model, which prints no block of its own, leaves the screen with no resume line on it rather than with one in another program's name. The harness offers no switch for that line, so the drop is a match on the words it opens with; a release that reworded it would print the duplicate again, which is what happened before and is the worst it can go back to. Every count is printed whatever it is, so a session that ran no tool now says `0 ran, 0 failed`. A session you reopened carries one row more, `History`, with the span of the conversation behind it; it is printed when the session's own record was written before this launch started rather than on any comparison of the durations, so a session opened fresh prints the sitting alone. Before, the tool counts were withheld on exactly the sessions where they were zero, a zero nobody can see reads as a feature that was never built, and the single figure printed was the whole conversation's span, so reopening a session and quitting at once reported hours from other days as the time this sitting took.

- An option in the first position that neither `lm` nor the chat takes is now named back by the harness that parses it, exiting 1, rather than by `lm`, exiting 2. `--dry-run` and `--yes` are the exception, because a verb's flag in front of its verb is a word out of order rather than a word misspelt and the harness knows of no verb to name: `lm` still refuses those two itself, exiting 2, and now says where the flag goes rather than listing the options it takes.

### Fixed

- A thinking level you choose in the chat's `/thinking` and keep now survives the next launch. `lm` handed the harness `--thinking low` on every launch, and that flag beats every level the harness has saved, so the level you kept was put back to `low` the next time you opened the chat. The level is now written once into the harness's own settings as its global default, exactly as `quietStartup` is, and a value already there is left alone, so the chat still opens at `low` when you have saved nothing and the harness resolves the rest its own way: the level saved for the model you are on first, the global default second. A model whose card claims no thinking is still clamped to the one level it has.

## [0.2.0] - 2026-08-29

### Added

- The chat now prints one closing line when you quit it: how many tools the session ran and how many of those failed, what it spent in tokens, and how long it lasted, measured from the session's own first record to its last rather than from a clock started when the line was written. Every figure is a count and none is a share; a session whose tools all worked says nothing about failures, a session that ran no tool says nothing about tools, and a session that never reached the model prints nothing at all, because none of the three is news to the person who was watching. The line goes to the terminal the harness has already restored, immediately above its own resume command, and a reload or a session replacement prints nothing, since the chat carries on through both.
- `lm <name> --help` now answers about that one tool: its description, its usage, the flags every tool takes, and, for a workflow, the verbs it runs in order and the flags it declared, all generated from what the tool file declares so no tool file writes a help handler.
- A composition is a named sequence of verbs that `lm` runs as one command: `lm ship` is now one, and a new file dropped into the registry beside the verbs, naming in its own `verbs` line the verbs it runs, is offered as a command and in the chat in the next session with no other file edited.
- `lm --help` lists a composition under a heading of its own, `Available workflows`, beside the tools, and names it in the Usage block above them, so a sequence of verbs is offered as a command of its own rather than left to be inferred from the verbs it runs. `workflow` is the word on the screen for what a tool file that declares verbs becomes.
- The chat now offers every model the local ollama has, listing them when `/model` opens and again at startup, and each model declares the smaller of its own context length and `LM_CTX`. The read the launch waits on is bounded at two seconds, so an `LM_OLLAMA` host that accepts the connection and never answers opens the chat on the single model `LM_MODEL` names instead of holding the launch before anything is drawn, which is what a refused connection already did.
- A model the operator saved inside the chat is now honoured on the next launch: the chat opens on it rather than on `LM_MODEL`, and a saved provider and model together count as the choice while either one alone does not.
- `LM_MAX_TOKENS` sets how many tokens a verb's answer may cost, defaulting to 3000, and an answer that reaches it is still cut off and exits 5 as before.
- `lm stats` takes `--since <date>`, which splits the runs at that date and prints the clean share of each period beside its sample, so the column answers how the share moved rather than what it has settled at; each period withholds its own share below the same fourteen-run minimum the table uses, and a value that is not a date is refused.
- A confirmation or question that nobody answers no longer holds the verb open for ever: the read now gives up after two minutes, the verb exits 7 as a refusal does, applies nothing, and says on the terminal that it got no answer in time, while an answer that arrives before the bound still applies and a refusal is still reported as a refusal.
- A repository can now ship verbs of its own: with `LM_TOOLS` unset the registry is the `tools/` of the repository you are standing in followed by the `tools/` of the installation, so a file dropped into a project is listed, runnable and offered in the chat without being installed, and a name the project also ships shadows the installation's rather than appearing twice. `lm --list` prints `project` in a third tab-separated field for every entry the project supplied.
- The chat's `/thinking` works. Each model is now declared from its own card, which `/api/show` already answers with a `capabilities` array beside the context length, so a model that advertises thinking is offered the harness's levels and one that does not is offered none; the levels reach ollama as `reasoning_effort` under their own names, and the level that reads as closed is mapped to `none`, which is the only form that closes the channel on `/v1`. The chat opens at `low`, one notch below the harness's own default and named rather than inherited, and a model whose card advertises no thinking opens at the one level it has.
- `LM_THINK` sets the effort a verb asks the model for, defaulting to `none`, which is what every verb asked for before it. The chat does not read it: its level is `/thinking`, per session.
- `--yes` on any verb answers the verb's own question, for a run with nobody at the terminal to answer it: the confirmation is taken as given, and a question the tool asks gets an empty line, which each tool already reads its own way, so `lm issue` keeps the labels the model proposed. `LM_YES=1` is the same thing through the environment, which is what a script or a cron entry sets rather than threading a flag through. The flag goes after the verb like `--dry-run`, so `lm commit --yes` runs while `lm --yes commit` is refused, and `lm ship --yes` carries it to both verbs it runs. Neither reaches a chat session: it has a person in it by construction, and its dialog is still asked.
- Every run now records what happened to the question the verb asked, under `consent`: `given` when it was answered, `withheld` when it was declined, when the dialog was closed and when the wait ran out, `assumed` when the run carried `--yes` and nobody was asked, and `null` when the run never got that far, which is a rehearsal, a verb with nothing to work on, or an answer the validator would not take. It is read from the mode the run asked for and the status the run ended on, so `withheld` is exit 7 and does not tell a person who said no apart from a question nobody answered. `lm stats` does not report it.

### Changed

- `lm --help` now lists the tools and workflows as names alone under their own headings, with a pointer to `lm <name> --help` for the detail, rather than printing each one's description beside it.
- `lm ship` is no longer named in the Usage block of `lm --help`; it appears only in the workflows listing, since `lm stats` is `lm` itself rather than something this repository ships.
- The documentation now separates the contract every verb runs under from the verbs this repository happens to ship, so a project writing verbs of its own can tell which sentences apply to it: the flags every verb takes, the run log, configuration and exit codes are in `docs/verbs.md` and hold whatever registry a verb came from, while the four verbs and the one composition that sit in `tools/` here have `docs/instruments.md` to themselves. The README and the install page point to the two.
- A verb run inside a composition records the composition's name in the run log, so `lm stats` can tell a run that came from a composition apart from one typed by hand.
- A composition's confirmations and questions arrive as the chat's own dialogs, a refusal applies nothing and says so, and a delivery that produces nothing still reports its exit code.
- `LM_MODEL` is now the model a verb asks and the chat's default, so a model saved inside the chat no longer changes what a verb asks.
- The default context window is now 65536 tokens, matching what this machine's ollama serves, so the chat no longer compacts early against a window the server does not hold and a conversation can grow to what ollama actually keeps.
- `LM_CTX` now reaches only the chat, which accounts the conversation against it, and `lm --which`, which posts it as `num_ctx` on the call it makes: a verb's answer budget no longer follows the window, so a window sized for a smaller card no longer shortens a verb's answer, and the budget is `LM_MAX_TOKENS` whatever the window says.
- `LM_TOOLS`, when set, is now documented and pinned as the whole registry rather than the first directory of one: it names exactly one directory and the installation's `tools/` is not consulted beside it, which is what every existing invocation already did.
- Verb answers are now sampled greedily: the runner pins temperature 0 on every request, so the same diff produces the same message again, where before the model's own default of 1 decided and answers varied between identical runs.
- `lm stats` now withholds the clean share when a verb has fewer than fourteen runs, printing `n<14` instead of a percentage, and prints the percentage again from the fourteenth run on: at smaller samples no outcome can put the edit share below one in five, so a figure no sample can contradict is not a measurement.
- The chat now asks the model for no answer budget at all. It used to send one under a name ollama discards, so the number bounded nothing and `LM_CTX` quietly divided it; what bounds a turn now is the context window it accounts against and the person watching the answer arrive. A verb still asks for `LM_MAX_TOKENS` under the name ollama honours.
- The chat's status rows carry the model on the first row, beside the working directory and the branch, and the second row holds the context against its window, what the session has spent and the thinking level the session is at. The spend and the level sit in the same grey, while the context figure leaves it for the theme's warning colour past 70% of its window and its error colour past 90%, and the thinking slot is left empty rather than grey for a model whose card advertises no thinking, where a level would be a claim about a request the model does not honour.

### Fixed

- `lm ship --dry-run` no longer changes the repository it was asked to rehearse. It staged the working tree and cut a placeholder branch before any model call, and renamed that branch after a commit the run never made, because the flag reached the composition and guarded nothing inside it. A rehearsal now runs none of the composition's own steps, so the working tree, the branch you are on, the branches that exist, `HEAD` and the reflog all read after it exactly as they did before; each verb is rehearsed against the repository as it stands, which the run says on stderr, because that is thinner than the delivery and a verb may refuse for want of what a step would have done.
- The exit code table omitted 1, which `lm` returns whenever a verb's side effect fails: a commit a hook rejected, a tool file that asks a question outside `apply`, or a body killed before it could return a status. It is listed now, with the note that `git commit` reports 1 whatever code the hook itself exited with, so what the hook printed is the only thing that says why.
- The exit codes page said what a verb reports and never said that the chat can go around the verb altogether. The chat hands the model a shell beside the verbs, so it can stage the tree, write the commit and push it without reaching a verb at all, and the confirmation you answer, the validator and the run record are bypassed together: `HEAD` moves to a subject no validator saw while the log's record for that session reads exit 7 or 3. The page says so now, and names `lm chat --exclude-tools bash`, which takes the shell away so the same request stops at the verb.

## [0.1.0] - 2026-08-27

### Added

- The chat introduces itself as this project rather than as the harness it is built on: its own mark, name and version on top, one dim row naming what to type, and two status rows carrying the working directory, the branch, what the session has spent, the context against its window and the model. The harness's own extension list is no longer printed, because the only extension in it is this program.
- The chat runs the repository's own verbs instead of only talking about them. Every tool file in the registry is offered to the model in the session and takes what a human types on the command line, free text and `--dry-run`, and nothing about its own answer: the verb still writes its own prompt from the repository and asks the model itself, so what it commits is what `lm commit` commits. Its questions arrive as the chat's own dialogs, a refusal applies nothing and says so, and a fifth tool file dropped into the registry is offered in the next session with no file edited.
- A verb's `apply` function now runs after the model's answer is validated and rendered: it executes under `set -euo pipefail` so a failure stops it where it stands, and `confirm` inside it asks the human at the terminal, exiting 7 on a refusal. A `confirm` called from any other function is still refused, now naming the function rather than the bridge.
- `lm stats` now reports the time the model itself spent beside the time a run took, and the two differ by however long you took to answer the confirmation prompt: the old column has your thinking in it and the new one does not. A verb with no run recorded that way shows `-` rather than being reported as instant. The run log keeps ollama's six numbers behind the column, summed over both calls when a run took the retry.
- Every run now records a hash of its prompt, a hash of the answer and the answer's length, so a change in what a verb sends or gets back is visible without the log holding either text. A verb that refused before building a prompt leaves all three empty, while a run whose model returned nothing keeps its prompt hash and records a length of zero. `lm stats` does not report them.
- `lm` with no arguments opens an interactive chat against the local model. The endpoint and the model come from the environment variables the verbs already read, so there is nothing to configure and nothing leaves the machine.

### Changed

- `README.md` is now a front page rather than a manual: what the project is, why a local model is given work this narrow, the shape of a tool file, three lines to install, and links out. Requirements, the full install and the first run moved to `docs/install.md`, which is where a list of the verbs and their options now lives.
- A tool asks the human through `confirm "text"` and `ask "text"`, and no tool file reads `/dev/tty` itself. `lm issue` takes its labels line through `ask`, which is what lets it run inside the chat as well as on the command line; the wording of every question stays in the tool file, because a runner that composed the question would have to know what a tool's fields mean. A question that goes unanswered, such as a dialog you close, stops the verb with the same exit 7 a refused confirmation gives, while an empty answer is an answer: pressing Enter at `lm issue`'s labels line keeps the labels it proposed.
- The run log's call count is now the number of requests the model served rather than the number of turns the harness took, and a verb no longer inherits the harness's automatic retry or its compact-and-retry: both are on by default, both read their settings from a file outside this repository, and either can spend model calls that nothing in the run log would show.
- `--dry-run` on a verb now renders the output and stops, printing `--dry-run: no side effect`, rather than proceeding to the side effect.
- A flag a verb does not declare, such as `--dry-runn`, is now an error naming the flag and listing the verb's known flags, rather than reaching the model as prompt text.
- One command. `lm ship` and `lm stats` do what the separate `lm-ship` and `lm-stats` programs did, and `bin/` now holds `lm` and nothing else. A script calling `lm-ship` or `lm-stats` has to call `lm ship` or `lm stats` instead.
- `lm --help` describes the whole command: the chat, the verbs, `ship`, `stats`, the options and the environment variables it reads. It answers wherever `-h` or `--help` appears, so `lm commit --help` prints it too. Before, it listed the four verbs and nothing else.
- The chat needs Node 24, with packages installed by `npm ci`; its file tools need `fd` and `ripgrep` on `PATH`; and under `tmux` it needs `extended-keys on`, or modified `Enter` keys never reach it. The verbs need none of this. Without `fd` and `ripgrep` the chat starts, tries to download them itself, and warns when that fails.

### Fixed

- A verb's answer is bounded by the token budget again. Through the chat harness the limit was sent in a field ollama does not read, so an answer could run past it and be treated as a finished one; it now goes in the field ollama honours, an answer cut short by it says so and exits 5 rather than being rendered, and a verb asks the model not to think, which is what makes an answer fit: the same `lm changelog` run spent 5290 output tokens and was cut off with reasoning on, and 117 with it off. The chat is unchanged and still thinks.
- A mistyped or misplaced option in front of a verb, such as `lm --hlp` or `lm --dry-run`, is now refused by name and answered with the options `lm` itself takes. Before, it was reported as a missing verb and answered with the list of verbs, which cannot contain an option.
- The contributor documentation claimed every tool reports three `shellcheck` findings. `changelog` reports four, and the page now says which one and why it is left alone.

## [0.0.5] - 2026-08-26

### Changed

- The `changelog` command now refuses a bullet that names a function only the source knows, such as one describing how a listing is formatted rather than what the listing looks like. The functions documented as the tool contract stay allowed.
- A `--which` request is now recorded in the run log whether it names a verb or refuses, and `lm-stats` reports how many requests found no verb at all. The record carries the verb that was picked, or `none`, in a field the other runs leave empty, and is kept out of the per-verb table so a refusal is not counted as a failure.

## [0.0.4] - 2026-08-26

### Added

- The `lm-ship` command, which stages the working tree, then runs `commit` and `pr` over the same text, opening a thematic branch named after the commit subject. A dirty tree ships without a separate `git add`, untracked files included and `.gitignore` still honoured. `--here` commits on the current branch, and `--no-stage` ships only what was staged by hand.

### Changed

- The `issue` command now requires a topic argument when nothing is staged, rather than prompting interactively for the issue summary.
- The `issue` command now fails immediately if repository labels cannot be retrieved, preventing a model call that would lack a valid label set.
- The `issue` command now includes the user-provided topic in the prompt context when supplied alongside staged changes.
- The `changelog` command now exits with an error if `CHANGELOG.md` lacks an `## [Unreleased]` section, preventing a wasted model call when there is no target section to draft into.
- An answer cut short by the token budget is now a failure instead of a result: every verb exits 5 and says the answer was cut off, where before a truncated answer that still parsed was rendered and applied as a finished one.
- The `pr` command now warns when the remote-tracking base branch is behind the local branch of the same name, indicating that some commits are already on the local branch and suggesting a fetch to ensure the description covers only the current branch's changes.
- `lm --which` can now answer that no verb serves a request: it prints nothing, says so on stderr and exits 2, where before the answer was constrained to the registry's names and the nearest verb came back instead.
- Each run record now carries the composition that produced it, so the two records `lm-ship` leaves are no longer indistinguishable from two verbs typed by hand; `lm-stats` reports how many runs came from a composition. A verb run directly records `null`.

### Removed

- The `fix` command, which repaired mechanical build errors using the Go compiler as the oracle

### Fixed

- An empty `LM_LOG` now keeps a run out of the log, as the configuration documents. Before, `LM_LOG=` fell through to the default path and every such run was appended to `$HOME/.lm/runs.jsonl`, so `lm-stats` counted rehearsals and fixture repositories alongside real work.

## [0.0.3] - 2026-08-25

### Added

- Support for verb-specific flags declared in the `flags` variable, allowing tools to accept custom options alongside `--dry-run`.
- A `--` separator that treats all subsequent arguments as literal text, preventing them from being interpreted as flags.
- A warning message when free-text input is provided but not included in the generated prompt, alerting the user that their text was ignored.
- Support for free-text descriptions in `lm changelog` and `lm commit`, allowing the user to specify the intent of the change when no diff is available or to supplement the diff context.

### Changed

- The `changelog` command now drafts entries against the full published history of the project rather than only the current Unreleased section, allowing it to match the project's established vocabulary and scope.
- The `commit` command no longer refuses to run on protected branches such as `main`, `master`, `develop`, `release/*`, or `hotfix/*`.
- Unknown flags now trigger a specific error message listing valid options, rather than being silently passed as text to the tool.
- `lm changelog` now reads the working tree diff when nothing is staged, enabling changelog entries to be drafted before changes are staged.
- `lm commit` now provides a specific error message when the working tree has changes but nothing is staged, guiding the user to stage changes first.
- `lm changelog` names the files that are changed but not staged, because the entry it drafts from the index will not cover them.
- The `--help` flag is now recognized in any position within the command line, not just as the first argument.
- The `--dry-run` flag can now be placed in any position relative to other arguments, allowing it to coexist with free-text inputs in either order.
- The changelog tool now drafts multiple entries for a single commit, grouping them by category in the output and applying them to CHANGELOG.md in one pass.
- `lm-stats` reports the runs from the tree you are in, the repository or the working directory when there is none, and `--all` reads the whole log.
- `lm-stats` refuses an unknown argument by name, and points at `--all` when the current repository has nothing logged.

## [0.0.2] - 2026-08-25

### Added

- Support for filling `.github/pull_request_template.md` sections in the `pr` command, where the script injects the template headings and the model supplies only the section contents
- A `declined` column in the `lm-stats` output, tracking runs where the human refused the confirmation prompt
- Run logging to a JSONL file and the `lm-stats` command for inspecting verb-level success rates, retry counts, and validator violations
- Support for drafting and applying CHANGELOG.md entries from the staged diff in the changelog command

### Changed

- Declining a confirmation prompt now exits with code 7 instead of 0, so a caller can tell a refusal from a completed run
- `lm --help` and `lm -h` now print to standard output and exit 0, while `lm` with no arguments keeps printing to standard error and exiting 2
- The command listing under `lm --help` aligns descriptions in a column whose width follows the longest verb, and `lm --list` stays tab-separated for scripts
- The `pr` command reads its commits and diff from the remote-tracking default branch rather than the local one, so the description matches what the pull request will show

### Removed

- The standalone `lm-commit` script, superseded by the `commit` entry in the tool registry

### Fixed

- The diff the `pr` command shows the model starts at the merge base, so commits that landed on the default branch no longer appear as deletions of files the branch never touched
- The `pr` command now resolves the target branch via `git symbolic-ref` or a fallback list instead of defaulting to `main`, and refuses to run when the current branch is the target branch
- The `pr` command now pushes the current branch to the remote before creating the pull request, which `gh` cannot do on its own when its prompt has nowhere to read an answer from
- The `commit` and `pr` commands now read their confirmation prompt from the terminal, so answering `y` creates the commit or the pull request instead of silently doing nothing
- The prose line-wrap check in the `pr` and `issue` commands, which accepted every body it was given

## [0.0.1] - 2026-08-24

### Added

- `lm`, a thin runner over a tool registry: one file per tool, `lm <verb>` dispatch, `--dry-run`, `lm --list`, and the `lm --which` router that picks a verb from free-form text
- `commit`, which writes a Conventional Commits message from the staged diff, with the scope enum built from the paths that changed
- `fix`, which repairs mechanical build errors using the Go compiler as the oracle and restores the file when the build still fails
- `pr`, which writes a pull request description from `git log <default>..HEAD`
- `issue`, which drafts a GitHub issue and picks its labels from the repository's own taxonomy

[Unreleased]: https://github.com/sergeyklay/lm/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/sergeyklay/lm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sergeyklay/lm/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/sergeyklay/lm/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/sergeyklay/lm/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/sergeyklay/lm/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/sergeyklay/lm/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sergeyklay/lm/releases/tag/v0.0.1
