. "$GOLDEN/_env.sh"
mkdir -p tools docs
printf 'name="demo"\n' > tools/demo.sh
printf '# Guide\n' > docs/guide.md
git add .; git commit -qm "feat: add the demo tool"
git checkout -qb feat/two
printf 'name="demo"\ndescription="one line"\n' > tools/demo.sh
printf '# Guide\n\nHow to install it.\n' > docs/guide.md
