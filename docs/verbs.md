# What each verb does

`README.md` lists the verbs; this page says how each one behaves, and what the two
compositions and the configuration around them do.

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

Every run appends one JSON object to `$LM_LOG` — the verb, the repository, how many model
calls it took, what the validator rejected, the exit code, whether `HEAD` moved, and which
composition the run belonged to, or `null` when you typed the verb yourself. A `lm --which`
run is logged in the same shape: it names `--which` where a run names its verb, and carries
the verb it picked, or `none`, in a field every other run leaves `null`.

Each record also carries a hash of the prompt, a hash of the answer and the answer's length, so
a change in what a verb sends or gets back is visible without the log holding either text. Each is
`null` when there was nothing to record, and the two halves fall separately: a verb that refused
before building a prompt leaves all three empty, while a run whose model returned nothing keeps
its prompt hash and reports a length of zero. That zero is not an absent answer. It is the model
answering with nothing, and it exits 5.

`lm stats` reads that log and nothing else: no model, no registry, no network. It reports a row
per verb — runs, how many were clean on the first answer, how many you declined, how many took
the retry, how many failed, and the average time a run took with your own thinking in it —
then how many `lm commit` runs actually moved `HEAD`, then how many runs came from a
composition rather than from your hands, then how many `lm --which` requests found no verb at
all, then the violations the validators printed most often. `--which` is kept out of the table,
because it is a run and not a verb and its refusal exits 2, which the table would count as a
failure. A `--dry-run` reaches the violations but not the rates. One log spans every
repository `lm` has ever run in, so it counts the one you are in.

```bash
lm stats                       # this repository
lm stats --all                 # every repository the log has seen
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

A composition stops on any of these. 7 is the one that is not a failure — it is you saying no.

| Code | Meaning |
| --- | --- |
| 2 | no such verb, an undeclared flag, or not a git repository |
| 3 | the verb has nothing to work on |
| 4 | the validator rejected two answers |
| 5 | the model returned nothing usable: empty content, or an answer cut off by the token budget |
| 7 | you declined the confirmation |

The gap at 6 is deliberate. It belonged to `lm fix` and went when that verb was removed, so the
next verb that reverts its own work takes it back rather than inventing an eighth code;
`grep -rn 'exit 6' bin/ libexec/ src/ tools/` finds nothing today.
