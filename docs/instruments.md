# What this repository ships

`lm` itself is [the runner](runner.md), the contract in [running a verb](verbs.md) and the
registry contract in [adding a tool](tools.md). This page is the other half: the four verbs and
the one workflow that happen to sit in `tools/` here. A project that installs `lm` puts its
own there, and none of them is part of `lm`.

## The verbs

`lm pr` fills `.github/pull_request_template.md` when the repository has one: the section
headings become the schema, and the script writes them back, so the model only supplies
the contents.

`lm changelog` reads the index when something is staged and the working
tree otherwise, so an entry can be drafted before anything is staged, or from the text alone
when nothing has changed at all.

`lm commit` reads everything uncommitted, splits it into one commit per independent change and
makes them all, so a dirty tree becomes a history without a `git add` of your own: modified files
and untracked ones both go in, and `.gitignore` is honoured. It shows the whole grouping and asks
once before any commit is made, because a wrong commit boundary is the one thing the validator
cannot see. Each commit takes the tree exactly as it stood when the run began, so an edit
made while the run is thinking is not swept into it. `--no-stage` narrows it to what you have
already staged, which is what you want when you staged a subset yourself. If a hook stops a commit part-way through the series, the ones before
it stand: the verb says which landed and which files are left, and exits 8.

```bash
lm commit                      # group the dirty tree and commit each group
lm commit --no-stage           # only what you staged yourself
```

A drafted bullet is refused when it names something only the source knows: the functions
`docs/tools.md` publishes as the tool contract are fair game, the project's other functions are
not. Name what a user of the verb can see instead.

## lm ship

`lm ship` runs `commit` then `pr` over the same text. It opens a thematic branch named
`<type>/<kebab-description>` after the subject the model writes, so the branch you end up on
follows the work rather than the other way round, and `commit` makes its commits on that branch.
`--here` commits where you already are. `--no-stage` is `commit`'s flag and is typeable here too,
where it means the same thing. Declining the commit leaves neither a branch nor a commit, and
leaves the index as you left it.

```bash
lm ship                        # branch, commit, pull request
lm ship --here "what changed"  # same, on the branch you are on
lm ship --no-stage             # ship only what you staged yourself
```
