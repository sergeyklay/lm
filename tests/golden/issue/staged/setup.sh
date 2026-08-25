. "$GOLDEN/_env.sh"
printf 'name="demo"\n' > demo.sh
git add .; git commit -qm "feat: add the demo tool"
printf 'name="demo"\ndescription="one line"\n' > demo.sh
git add demo.sh
# The tool caches the repository's labels in the git directory for a day and
# only reaches for gh when that file is missing or stale. Seeding it keeps the
# fixture offline and keeps the enum in schema() fixed.
printf 'bug\nenhancement\ndocumentation\n' > "$(git rev-parse --git-dir)/lm_labels_cache.txt"
