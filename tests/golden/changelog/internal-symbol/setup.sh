. "$GOLDEN/_env.sh"
printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- An earlier entry\n\n## [0.0.1] - 2026-01-01\n\n### Added\n\n- The first release\n' > CHANGELOG.md
printf 'name="demo"\n' > demo.sh
git add .; git commit -qm "feat: add the demo tool"
printf 'name="demo"\ndescription="one line"\n' > demo.sh
git add demo.sh
