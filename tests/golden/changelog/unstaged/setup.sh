. "$GOLDEN/_env.sh"
printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- An earlier entry\n' > CHANGELOG.md
printf 'name="demo"\n' > demo.sh
git add .; git commit -qm "feat: add the demo tool"
# Changed and deliberately left out of the index.
printf 'name="demo"\ndescription="one line"\n' > demo.sh
