# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A second runner, written in TypeScript and running on Node without a build step or a dependency, alongside the shell one. It reads the same registry: a tool stays a shell script, and the new runner sources it and calls one function per process, so a tool cannot tell which runner invoked it. Applying a result is not wired through it, so nothing a user already does behaves differently.
- `lm-next`, the command that reaches the new runner. It serves `--list` and `--help`, resolves the verb, and applies the same argument rules as `lm` — a flag and free text in either order, text after `--` kept literally, an undeclared flag refused as a typo rather than passed to the model as words. Where the model call would be it says so and stops. Its usage line already names `lm`, which is the command it becomes.
- The runner documentation, covering the two runners, what the new one provides a tool and what it deliberately does not, and why every one of its tests is stated against what the shell runner produces.

### Fixed

- The contributor documentation claimed every tool reports three `shellcheck` findings; `changelog` reports four. The fourth is a false positive and the page now says so and why, rather than reporting a count that no longer matches the command printed beside it.

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

[Unreleased]: https://github.com/sergeyklay/lm/compare/v0.0.5...HEAD
[0.0.5]: https://github.com/sergeyklay/lm/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/sergeyklay/lm/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/sergeyklay/lm/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/sergeyklay/lm/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sergeyklay/lm/releases/tag/v0.0.1
