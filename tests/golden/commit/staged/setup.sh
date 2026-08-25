. "$GOLDEN/_env.sh"
mkdir -p tools
printf 'name="demo"\n' > tools/demo.sh
git add .; git commit -qm "feat: add the demo tool"
git checkout -qb feat/widen
printf 'name="demo"\ndescription="one line"\n' > tools/demo.sh
git add tools/demo.sh
