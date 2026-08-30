. "$GOLDEN/_env.sh"
mkdir -p src tools libexec
: > CHANGELOG.md; : > src/chrome.mts; : > libexec/lm-stats
: > tools/alpha.sh; : > tools/beta.sh; : > tools/gamma.sh
git add .; git commit -qm "feat: seed the fixture"
git checkout -qb feat/weigh
seq 1 40 > src/chrome.mts
seq 1 10 > libexec/lm-stats
seq 1 2 > tools/alpha.sh; seq 1 2 > tools/beta.sh; seq 1 2 > tools/gamma.sh
seq 1 1 > CHANGELOG.md
git add .
