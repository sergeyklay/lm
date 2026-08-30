. "$GOLDEN/_env.sh"
# A changelog with releases but no [Unreleased]: nothing has accumulated to cut
printf '# Changelog\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- The first release\n\n[0.1.0]: https://example.invalid/demo/releases/tag/v0.1.0\n' > CHANGELOG.md
printf '{\n  "name": "demo",\n  "version": "0.1.0",\n  "private": true\n}\n' > package.json
git add .; git commit -qm "chore: seed the repository"
