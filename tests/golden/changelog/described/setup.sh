. "$GOLDEN/_env.sh"
printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- An earlier entry\n' > CHANGELOG.md
printf 'name="demo"\n' > demo.sh
git add .; git commit -qm "feat: add the demo tool"
# Clean tree: the only thing the verb has to go on is what the human said.
