. "$GOLDEN/_env.sh"
printf 'base\n' > f.txt
git add .; git commit -qm "chore: seed the repository"
git update-ref refs/remotes/origin/main HEAD
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
git checkout -qb feat/widen
printf 'base\nwidened\n' > f.txt
git add f.txt; git commit -qm "feat: widen the file"
