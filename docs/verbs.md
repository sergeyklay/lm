# What each verb does

[Installing lm](install.md) lists the verbs and how to meet them; this page says how each one
behaves, and what `ship`, `stats` and the configuration around them do.

## The verbs

`lm pr` fills `.github/pull_request_template.md` when the repository has one: the section
headings become the schema, and the script writes them back, so the model only supplies
the contents.

A verb takes free text after its name, and passes it to the model as what the human meant
the change to be. `lm changelog` reads the index when something is staged and the working
tree otherwise, so an entry can be drafted before anything is staged, or from the text alone
when nothing has changed at all. `lm commit` reads the index and only the index, because
that is what it commits.

`--dry-run` on any verb prints the result and stops before the side effect. `lm --which`
picks the verb for a request by reading the same one-line descriptions `lm --list` prints. When
no verb serves the request it prints nothing, says `no verb serves that request` on stderr and
exits 2, so a composition that pipes it into `lm` stops rather than running the nearest match.
Either answer is logged, so how often the registry has no verb for what you asked is a share
`lm stats` prints rather than something you have to remember.

A drafted bullet is refused when it names something only the source knows: the functions
`docs/tools.md` publishes as the tool contract are fair game, the project's other functions are
not. Name what a user of the verb can see instead.

## lm ship

`lm ship` runs `commit` then `pr` over the same text. It stages the working tree first, so a
dirty tree ships without a `git add` of your own: modified files and untracked ones both go
in, and `.gitignore` is honoured. It then opens a thematic branch named
`<type>/<kebab-description>` after the subject the model writes, so the branch you end up on
follows the work rather than the other way round. `--here` commits where you already are.
`--no-stage` leaves the index alone, which is what you want when you have staged a subset
yourself. Declining the commit leaves neither a branch nor a commit, and leaves the staging in
place.

```bash
lm ship                        # stage, branch, commit, pull request
lm ship --here "what changed"  # same, on the branch you are on
lm ship --no-stage             # ship only what you staged yourself
```

## lm stats

Every run appends one JSON object to `$LM_LOG`: the verb, the repository, how many model
calls it took, what the validator rejected, the exit code, whether `HEAD` moved, and which
composition the run belonged to, or `null` when you typed the verb yourself. A `lm --which`
run is logged in the same shape: it names `--which` where a run names its verb, and carries
the verb it picked, or `none`, in a field every other run leaves `null`.

Each record also carries a hash of the prompt, a hash of the answer and the answer's length, so
a change in what a verb sends or gets back is visible without the log holding either text. Each is
`null` when there was nothing to record, and the two halves fall separately: a verb that refused
before building a prompt leaves all of them empty, while a run whose model returned nothing keeps
its prompt hash and reports a length of zero. That zero is not an absent answer. It is the model
answering with nothing, and it exits 5.

It carries the numbers ollama reports beside the answer too, under ollama's own names and in its
own nanoseconds: `total_duration`, `load_duration`, `prompt_eval_count`, `prompt_eval_duration`,
`eval_count` and `eval_duration`. They are summed over the calls a run made, so a run that took
the retry shows two lots of model work rather than the second lot alone. A reply carrying none of
them leaves them all `null`: zero nanoseconds of model work is a claim, and none was made.

`lm stats` reads that log and nothing else: no model, no registry, no network. It reports a row
per verb: runs, how many were clean on the first answer, how many you declined, how many took
the retry, how many failed, the average time a run took with your own thinking in it, and the
average the model itself reported, which has none of your thinking in it. The two differ because
a run is recorded after the verb applies and every verb waits for your answer at the terminal
first, so the wait is inside the one and outside the other. A run whose record holds no model
time is left out of that average, and a verb with no such run shows `-` rather than being
reported as instant. Then how many `lm commit` runs actually moved `HEAD`, then how many runs came from a
composition rather than from your hands, then how many `lm --which` requests found no verb at
all, then the violations the validators printed most often. `--which` is kept out of the table,
because it is a run and not a verb and its refusal exits 2, which the table would count as a
failure. A `--dry-run` reaches the violations but not the rates. One log spans every
repository `lm` has ever run in, so it counts the one you are in.

The clean column is the one figure here that is read against a threshold, so it carries the
sample that threshold needs and prints `n<14` until the verb has fourteen runs. It counts the
runs whose first answer passed the validator and was accepted as it stood, and the number to
read it against is manual edits staying under one in five. Fourteen is the smallest sample that
reading is reachable from at all: at 95% one-sided confidence a verb with no edits whatever in
thirteen runs still admits an edit rate of 20.6%, and fourteen brings it to 19.3%, which is
`ceil(ln 0.05 / ln 0.8)`. Below fourteen every possible sample confirms the threshold, and a
figure no sample can contradict is not a measurement. Fourteen runs say the figure may be read,
not that the reading is settled. A message accepted here and rewritten afterwards with
`git commit --amend` still counts as accepted, so the column is an upper bound on what went
through untouched.

`--since <date>` reads the axis the table does not. It splits the runs in two at that date and
prints the clean share of each period beside its sample, so the column answers how the share
moved rather than what it has settled at. Each period is read against the same minimum the table
uses and withholds itself below it, so a period of four runs prints `n<14` whatever those four
runs did, and a period with nothing in it prints the same rather than a share of no runs. The
comparison is on the timestamp as it was written, so a log whose records carry two different UTC
offsets splits by local time; every record in the log this was measured against carries one, which
`jq -r '.ts' $LM_LOG | grep -oE '[+-][0-9]{2}:[0-9]{2}$' | sort -u` reports. A value that is not a
date is refused rather than read as a period nothing falls in.

```bash
lm stats                       # this repository
lm stats --all                 # every repository the log has seen
lm stats --since 2026-08-26    # before that date beside since it
```

## Configuration

Environment only:

| Variable | Default |
| --- | --- |
| `LM_OLLAMA` | `http://127.0.0.1:11434` |
| `LM_MODEL` | `qwen3.8:27b` |
| `LM_CTX` | `32768` |
| `LM_TOOLS` | `<repo>/tools` |
| `LM_LOG` | `$HOME/.lm/runs.jsonl` |

Set `LM_LOG` to an empty string to keep a run out of the log entirely: `LM_LOG= lm commit` writes no record, and `lm stats` under the same setting reads none. That is what a fixture repository or a rehearsal wants, because one log spans every repository and `lm stats` counts the one you are in.

## Exit codes

A composition stops on any of these. 7 is the one that is not a failure: it is you saying no.

| Code | Meaning |
| --- | --- |
| 1 | the side effect failed: the command `apply` ran returned 1, the tool file asked a question outside `apply`, or its body was killed |
| 2 | no such verb, an undeclared flag, or not a git repository |
| 3 | the verb has nothing to work on |
| 4 | the validator rejected two answers |
| 5 | the model returned nothing usable: empty content, or an answer cut off by the token budget |
| 7 | you declined the confirmation |

From `lm commit` this most often means a hook rejected the commit, and the hook's own code is not
recoverable: `git commit` reports 1 whatever the hook exited with, so what the hook printed is the
only thing that says why.

Inside the chat a verb has no exit status to hand anyone, so the tool result says the same
thing in words: a refused confirmation reads `Declined. Nothing was applied.` and any other
failure names its code.

The gap at 6 is deliberate. It belonged to `lm fix` and went when that verb was removed, so the
next verb that reverts its own work takes it back rather than inventing an eighth code;
`grep -rn 'exit 6' bin/ libexec/ src/ tools/` finds nothing today.
