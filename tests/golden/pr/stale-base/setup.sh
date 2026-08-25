. "$GOLDEN/_env.sh"
printf 'base\n' > f.txt
git add .; git commit -qm "chore: seed the repository"
git update-ref refs/remotes/origin/main HEAD
git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
# main moves on and the branch is cut from it, while origin/main stays put
printf 'base\nshared\n' > f.txt
git add f.txt; git commit -qm "feat: land a shared change on main"
git checkout -qb feat/mine
printf 'base\nshared\nmine\n' > f.txt
git add f.txt; git commit -qm "feat: add my own line"
