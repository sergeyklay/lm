# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A composition is a named sequence of verbs that `lm` runs as one command: `lm ship` is now one, and a new file dropped into the compositions directory is offered as a command and in the chat in the next session with no other file edited.
- `lm --help` lists the compositions beside the verbs, and `LM_COMPOSITIONS` points `lm` at a compositions directory other than the one beside the tools.
- The chat now offers every model the local ollama has, listing them when `/model` opens and again at startup, and each model declares the smaller of its own context length and `LM_CTX`.
- A model the operator saved inside the chat is now honoured on the next launch: the chat opens on it rather than on `LM_MODEL`, and a saved provider and model together count as the choice while either one alone does not.
- `LM_MAX_TOKENS` sets how many tokens a verb's answer may cost, defaulting to 3000, and an answer that reaches it is still cut off and exits 5 as before.
- `lm stats` takes `--since <date>`, which splits the runs at that date and prints the clean share of each period beside its sample, so the column answers how the share moved rather than what it has settled at; each period withholds its own share below the same fourteen-run minimum the table uses, and a value that is not a date is refused.
- A confirmation or question that nobody answers no longer blocks the verb for two minutes: the read now times out, the verb exits 7 as a refusal does, applies nothing, and says on the terminal that it got no answer in time, while an answer that arrives before the bound still applies and a refusal is still reported as a refusal.

### Changed

- A verb run inside a composition records the composition's name in the run log, so `lm stats` can tell a run that came from a composition apart from one typed by hand.
- A composition's confirmations and questions arrive as the chat's own dialogs, a refusal applies nothing and says so, and a delivery that produces nothing still reports its exit code.
- `LM_MODEL` is now the model a verb asks and the chat's default, so a model saved inside the chat no longer changes what a verb asks.
- The default context window is now 65536 tokens, matching what this machine's ollama serves, so the chat no longer compacts early against a window the server does not hold and a conversation can grow to what ollama actually keeps.
- `LM_CTX` now reaches only the chat and `lm ship`: a verb's answer budget no longer follows the window, so a window sized for a smaller card no longer shortens a verb's answer, and the budget is `LM_MAX_TOKENS` whatever the window says.
- The chat now hands the model a shell beside the verbs, so it can stage, commit and push without reaching a verb at all, and `lm chat` takes `--exclude-tools bash` to take the shell away, after which the same request stops at the verb and its record is the only trace.
- Verb answers are now sampled greedily: the runner pins temperature 0 on every request, so the same diff produces the same message again, where before the model's own default of 1 decided and answers varied between identical runs.
- `lm stats` now withholds the clean share when a verb has fewer than fourteen runs, printing `n<14` instead of a percentage, and prints the percentage again from the fourteenth run on: at smaller samples no outcome can put the edit share below one in five, so a figure no sample can contradict is not a measurement.

### Fixed

- The exit code table omitted 1, which `lm` returns whenever a verb's side effect fails: a commit a hook rejected, a tool file that asks a question outside `apply`, or a body killed before it could return a status. It is listed now, with the note that `git commit` reports 1 whatever code the hook itself exited with, so what the hook printed is the only thing that says why.

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

[Unreleased]: https://github.com/sergeyklay/lm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sergeyklay/lm/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/sergeyklay/lm/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/sergeyklay/lm/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/sergeyklay/lm/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/sergeyklay/lm/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sergeyklay/lm/releases/tag/v0.0.1
