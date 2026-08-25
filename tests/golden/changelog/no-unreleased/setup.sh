. "$GOLDEN/_env.sh"
# A changelog with releases but no [Unreleased]: there is nowhere to put an entry
printf '# Changelog\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- The first release\n' > CHANGELOG.md
printf 'echo hi\n' > tool.sh
git add .; git commit -qm "chore: seed the repository"
printf 'echo hello\n' > tool.sh
git add tool.sh
