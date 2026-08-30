. "$GOLDEN/_env.sh"
mkdir -p tools
printf 'name="demo"\n' > tools/demo.sh
git add .; git commit -qm "feat: add the demo tool"
