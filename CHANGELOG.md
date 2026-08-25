# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A `usage` function in the `lm` script that formats the command list with dynamic column alignment for the `--help` and no-argument invocations
- A `declined` column in the `lm-stats` output, tracking runs where the human refused the confirmation prompt
- Run logging to a JSONL file and the `lm-stats` command for inspecting verb-level success rates, retry counts, and validator violations
- Support for drafting and applying CHANGELOG.md entries from the staged diff in the changelog command

### Removed

- The standalone `lm-commit` script, superseded by the `commit` entry in the tool registry

### Fixed

- The `pr` command now pushes the current branch to the remote before creating the pull request, ensuring the PR is created against the latest remote state
- The `commit` and `pr` commands now read their confirmation prompt from the terminal, so answering `y` creates the commit or the pull request instead of silently doing nothing
- The prose line-wrap check in the `pr` and `issue` commands, which accepted every body it was given

## [0.0.1] - 2026-08-24

### Added

- `lm`, a thin runner over a tool registry: one file per tool, `lm <verb>` dispatch, `--dry-run`, `lm --list`, and the `lm --which` router that picks a verb from free-form text
- `commit`, which writes a Conventional Commits message from the staged diff, with the scope enum built from the paths that changed
- `fix`, which repairs mechanical build errors using the Go compiler as the oracle and restores the file when the build still fails
- `pr`, which writes a pull request description from `git log <default>..HEAD`
- `issue`, which drafts a GitHub issue and picks its labels from the repository's own taxonomy

[Unreleased]: https://github.com/sergeyklay/lm/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/sergeyklay/lm/releases/tag/v0.0.1
