# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
