. "$GOLDEN/_env.sh"
printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- An earlier entry\n' > CHANGELOG.md
printf 'name="demo"\n' > demo.sh; printf 'name="other"\n' > other.sh
git add .; git commit -qm "feat: add two tools"
printf 'name="demo"\ndescription="one line"\n' > demo.sh; git add demo.sh
# Changed as well, and deliberately left out of the index.
printf 'name="other"\ndescription="another"\n' > other.sh
