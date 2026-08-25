# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Support for verb-specific flags declared in the `flags` variable, allowing tools to accept custom options alongside `--dry-run`.
- A `--` separator that treats all subsequent arguments as literal text, preventing them from being interpreted as flags.
- A warning message when free-text input is provided but not included in the generated prompt, alerting the user that their text was ignored.
- Support for free-text descriptions in `lm changelog` and `lm commit`, allowing the user to specify the intent of the change when no diff is available or to supplement the diff context.
- Golden tests now capture and verify `stderr` output from the `collect` function, ensuring user-facing messages are stable.
- Support for an optional `args` file in golden test cases, allowing tests to pass specific arguments to the `collect` function.
- A golden test suite that pins the prompt, schema, validation, and render output of every verb against recorded fixtures
- A `--update` flag for the golden test runner to rewrite expectations, with a reminder to review the diff before committing
- Documentation in the README explaining how to run the golden tests and what they verify

### Changed

- The `changelog` command now drafts entries against the full published history of the project rather than only the current Unreleased section, allowing it to match the project's established vocabulary and scope.
- The `changelog` command no longer explicitly excludes tests, CI, and formatting from entries, instead relying on the project's existing changelog to define what is considered user-visible.
- The `commit` command no longer refuses to run on protected branches such as `main`, `master`, `develop`, `release/*`, or `hotfix/*`.
- Unknown flags now trigger a specific error message listing valid options, rather than being silently passed as text to the tool.
- The usage string now explicitly documents the `[text]` argument position for verbs.
- `lm changelog` now reads the working tree diff when nothing is staged, enabling changelog entries to be drafted before changes are staged.
- `lm commit` now provides a specific error message when the working tree has changes but nothing is staged, guiding the user to stage changes first.
- The `--help` flag is now recognized in any position within the command line, not just as the first argument.
- The `--dry-run` flag can now be placed in any position relative to other arguments, allowing it to coexist with free-text inputs in either order.
- The changelog tool now drafts multiple entries for a single commit, grouping them by category in the output and applying them to CHANGELOG.md in one pass.

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

[Unreleased]: https://github.com/sergeyklay/lm/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/sergeyklay/lm/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/sergeyklay/lm/releases/tag/v0.0.1
