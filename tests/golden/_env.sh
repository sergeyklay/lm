# Sourced by every setup.sh. Pins everything git would otherwise take from the
# clock, the environment or the user, so a fixture repository built today and
# one built next year produce byte-identical prompts.
export GIT_AUTHOR_NAME=lm GIT_AUTHOR_EMAIL=lm@example.invalid
export GIT_COMMITTER_NAME=lm GIT_COMMITTER_EMAIL=lm@example.invalid
export GIT_AUTHOR_DATE='2026-01-01T00:00:00+00:00'
export GIT_COMMITTER_DATE='2026-01-01T00:00:00+00:00'
git init -q -b main .
git config core.fileMode true
