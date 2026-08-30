. "$GOLDEN/_env.sh"
# An [Unreleased] with no entries under it: there is no release to cut
printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- The first release\n\n[Unreleased]: https://example.invalid/demo/compare/v0.1.0...HEAD\n[0.1.0]: https://example.invalid/demo/releases/tag/v0.1.0\n' > CHANGELOG.md
printf '{\n  "name": "demo",\n  "version": "0.1.0",\n  "private": true\n}\n' > package.json
git add .; git commit -qm "chore: seed the repository"
