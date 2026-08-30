. "$GOLDEN/_env.sh"
mkdir -p tools docs
printf 'name="demo"\n' > tools/demo.sh
printf '# Guide\n' > docs/guide.md
git add .; git commit -qm "feat: add the demo tool"
git checkout -qb feat/widen
printf 'name="demo"\ndescription="one line"\n' > tools/demo.sh
printf '# Guide\n\nHow to install it.\n' > docs/guide.md
git add .
# Staged, then edited again on top; and one file git add has never seen. The
# input set is the tree, so all three reach the prompt by three different routes.
printf 'name="demo"\ndescription="one line"\nverbs="x"\n' > tools/demo.sh
printf 'a note\n' > notes.txt
