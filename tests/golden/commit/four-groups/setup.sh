. "$GOLDEN/_env.sh"
mkdir -p tools docs libexec
printf 'name="demo"\n' > tools/demo.sh
printf '# Guide\n' > docs/guide.md
printf 'stats\n' > libexec/lm-stats
git add .; git commit -qm "feat: add the demo tool"
git checkout -qb feat/four
printf 'name="demo"\ndescription="one line"\n' > tools/demo.sh
printf '# Guide\n\nHow to install it.\n' > docs/guide.md
printf 'stats\nclean share\n' > libexec/lm-stats
printf '# Changelog\n' > CHANGELOG.md
