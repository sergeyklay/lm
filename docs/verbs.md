# Running a verb

[Installing lm](install.md) lists the verbs and how to meet them, and [what this repository
ships](instruments.md) says what each one does. This page is the contract every verb runs under,
whatever registry it came from: the flags it takes, the variables it reads, the codes it returns
and the record it leaves.

## What every verb takes

A verb takes free text after its name, and passes it to the model as what the human meant
the change to be.

`--dry-run` on any verb prints the result and stops before the side effect. `--yes` on any verb
answers the verb's own question, for a run with nobody at the terminal to answer it: the
confirmation is taken as given and a question the tool asks with `ask` gets an empty line, which
each tool already reads its own way - `lm issue` reads it as keeping the labels the model proposed.
`LM_YES=1` is the same thing through the environment, which is what a script
or a cron entry sets rather than threading a flag through. The flag goes after the verb, like
`--dry-run`: `lm commit --yes` runs, and `lm --yes commit` is refused, because nothing before the
verb is a verb's flag. `lm ship --yes` takes it as well and carries it to both verbs it runs, so a
whole delivery goes through with nobody at the terminal. What neither reaches is a chat session: a
chat has a person in it by construction, and its dialog is still asked.

On a composition `--dry-run` covers the whole delivery and not only the verbs inside it. `lm ship`
opens a branch and stages the tree around the verbs it runs, and those are side effects like any
other, so a rehearsal runs none of them: after `lm ship --dry-run` the working tree, the branch you
are on, the branches that exist, `HEAD` and the reflog all read exactly as they did before it. What
you see is each verb rehearsed against the repository as it stands, which is thinner than the run,
and the composition says so on stderr. A verb whose input an earlier step would have made refuses
the way it would if you ran it yourself now: on a tree nothing was staged in, `lm ship --dry-run`
reaches `commit` and `commit` exits 3.

Exit 7 is what a declined confirmation reports, so a run under `--yes` stops producing it rather
than producing it for a different reason.

A confirmation nobody answers is not a run that waits for ever. `lm` waits 120 seconds for the
answer and then stops, exits 7 and says so, applying nothing - the case it exists for is the
terminal left open on a desk somebody walked away from, where the wait had no bound at all. A run
with no terminal at all does not reach that wait: it exits 7 at once, because there is no
`/dev/tty` to read. `lm --which`
picks the verb for a request by reading the same one-line descriptions `lm --list` prints. When
no verb serves the request it prints nothing, says `no verb serves that request` on stderr and
exits 2, so a composition that pipes it into `lm` stops rather than running the nearest match.
Either answer is logged, so how often the registry has no verb for what you asked is a share
`lm stats` prints rather than something you have to remember.

## lm stats

Every run appends one JSON object to `$LM_LOG`: the verb, the repository, how many model
calls it took, what the validator rejected, the exit code, whether `HEAD` moved, and which
composition the run belonged to, or `null` when you typed the verb yourself. A `lm --which`
run is logged in the same shape: it names `--which` where a run names its verb, and carries
the verb it picked, or `none`, in a field every other run leaves `null`.

Each record names the caller it came from, under `caller`: `cli` when you ran the verb yourself,
`chat` when the chat ran it for you. It sits beside `composition` rather than inside it, so a
delivery says both which composition a run belonged to and who asked for the delivery, and a run
that belongs to no composition still says who asked for it. The set is closed and the command line
is the base case: a caller that is not a person at a prompt names itself in `LM_CALLER` before it
runs `lm`, and a value the set does not hold is read as `cli`. A record written before the field
carries no `caller` at all, and `lm stats` reads it beside the rest.

Each record says what happened to the question the verb asked, under `consent`: `given` when you
answered it, `withheld` when you declined or let the wait run out, `assumed` when the run carried
`--yes` and nobody was asked, and `null` when the run never got that far - a rehearsal, a verb with
nothing to work on, an answer the validator would not take. It is read from the mode the run asked
for and the status it ended on, so a body that fails before it reaches its own question is recorded
as `given`.

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
| `LM_CTX` | `65536` |
| `LM_MAX_TOKENS` | `3000` |
| `LM_THINK` | `none` |
| `LM_TOOLS` | unset, and the registry is a precedence |
| `LM_LOG` | `$HOME/.lm/runs.jsonl` |
| `LM_YES` | unset |

`LM_OLLAMA` is where every verb and the chat send their requests. The chat reads the model list
from it before it draws anything, and that read is bounded at two seconds: a host that refuses the
connection is answered at once, and one that accepts the connection and never answers would
otherwise hold the launch open for as long as it stays silent. Both degrade the same way, and
neither is fatal: the chat opens on the single model `LM_MODEL` names, and the list is read again
in the background and whenever `/model` opens, where the harness bounds the read itself. Two
seconds is thirty times what the read costs when it works, measured on 2026-08-28 at 66 ms cold and
10 ms warm for eight models against an ollama on the same machine, over the `/api/tags` call and the
one `/api/show` per model the read is made of.

`LM_TOOLS`, when set, is the whole registry: exactly the one directory it names, and nothing
beside it. When it is unset the registry is a precedence of two directories, nearest first: the
`tools/` of the repository you are standing in, then the `tools/` of the installation. The
repository is what `git rev-parse --show-toplevel` reports in the working directory, so outside a
repository, and in one with no `tools/` of its own, the installation's is the whole registry. A
name present in both resolves to the nearer file and is listed once. `lm --list` prints
`project` in a third tab-separated field for every entry the repository supplied, so a verb
shadowing one the installation ships is visible rather than silent; an entry from the
installation prints the two fields it always printed.

`LM_CTX` is what the service serves, not what a model can hold. Ollama bounds every model it loads,
and a card's own length is read per model by `card()` in `src/catalogue.mts`, so a new `LM_MODEL`
needs no new `LM_CTX`: a service or a card change is what moves this number. The two routes that can
act on a window read it. `lm --which` asks the model through `libexec/lm-verb`, which posts
`options.num_ctx` on `/api/chat`, where ollama honours it. The chat accounts against it: the harness
compares the conversation with that number to decide when to compact and what percentage to show. A
verb on the Node runner does neither, and its answer budget is `LM_MAX_TOKENS` whatever `LM_CTX`
says, the same budget `num_predict` carries on the other route. That runner sends no window at all,
and could not: ollama ignores `options.num_ctx` on `/v1/chat/completions`. So lowering this variable
asks the chat to account against a smaller window and does nothing else: it does not make the
server serve one, and there is no answer budget on that route for it to shrink.

The default is what this machine's ollama serves, and the two stay in step by hand. A service with
`OLLAMA_CONTEXT_LENGTH` unset picks its own on startup from the VRAM it finds — 262 144 above 47 GiB,
32 768 above 23 GiB and 4 096 below that, which `grep -n 'defaultNumCtx = ' server/routes.go` finds
at `v0.32.15` of `ollama/ollama` — so the number this variable has to match is the service's rather
than the card's.
`curl -sS http://127.0.0.1:11434/api/ps | jq -c '.models[] | {name, context_length}'` reports the
window a loaded model was given, and `OLLAMA_CONTEXT_LENGTH` in the service's environment is what it
is given when nothing asks for another. Declaring less than the server serves spends the difference
on nothing and compacts the chat early; declaring more lets a conversation grow past what ollama
holds, and ollama truncates the prompt at its own window without saying so.

There is a floor, and it is the harness's rather than the card's. The chat compacts at `LM_CTX` minus
a reserve of 16 384 tokens and keeps the most recent 20 000 whole, both defaults an operator can
change in the harness's own settings, so a window under the sum of the two arms the trigger over a
history it cannot cut: compaction fires every turn and summarises nothing. `tests/window.mts` pins
that through the harness's own `shouldCompact` and `findCutPoint`.

`LM_MAX_TOKENS` is that budget, and it is the one number both verb runners spend: `max_tokens` on
`/v1/chat/completions`, `num_predict` on `/api/chat`. An answer that reaches it is cut off, which is
exit 5 and not a short answer, so the runner says the budget is why.

It reaches no chat turn. The chat asks for no answer budget at all, under either name, and what
bounds a turn there is the window it accounts against and the person watching the answer arrive.
`docs/runner.md` carries the rest of what the chat asks for.

`LM_THINK` is the effort a verb asks the model for, and `none` is what it asks for unset: a verb is
one call under a budget, and an answer that fits the budget is one the model did not spend on
thinking first. Set it to an effort the model takes — `minimal`, `low`, `medium`, `high` — and that
is what `reasoning_effort` carries on `/v1/chat/completions`, in front of the same budget, so a verb
asked to think can run out of tokens before it answers. The chat does not read this variable: its
level is the harness's own `/thinking`, per session and per model, and it opens at `low`, one notch
below the harness's own default. That level is named rather than inherited, so a change in the
harness's default cannot move it, and a model whose card advertises no thinking is offered `off`
alone and opens there.

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

A verb called from inside the chat is a request the model may fulfil another way, and the codes
above are what it reports when it does call one. The chat hands the model a shell beside the
verbs, so it can stage the tree, write the commit and push it without reaching a verb at all, and
then the confirmation you answer, the validator, the message shaped after the ones already in the
log and the run record are bypassed together while the log still shows a verb run. Asked plainly to
commit, the model went past the refusal in four of six sessions measured on 2026-08-27, each in a
repository of its own: `HEAD` moved to a subject no validator had seen while every record those
sessions wrote read exit 7 or 3, so the log says you declined and the repository has a new commit.
In the other two it took the refusal at its word, said so, and offered you the `git commit` line to
run yourself - which is the same capability used the other way and not a guarantee of anything. This is why
`lm stats` counts the work that went through a verb rather than the work that was done.

Taking the shell away is one flag, and the same request then stops at the verb: nothing is staged,
`commit` exits 3, and the model says it cannot run git itself. Both halves are reproducible in a
repository with one modified file and a scratch log, which is what `tests/verb-live.mts` drives.

```bash
LM_LOG=/tmp/runs.jsonl lm chat -p 'commit the change'
LM_LOG=/tmp/runs.jsonl lm chat -p 'commit the change' --exclude-tools bash
git log --oneline -1 && jq -r '[.verb,.exit,.head_moved]|@tsv' /tmp/runs.jsonl
```

The gap at 6 is deliberate. It belonged to `lm fix` and went when that verb was removed, so the
next verb that reverts its own work takes it back rather than inventing an eighth code;
`grep -rn 'exit 6' bin/ libexec/ src/ tools/` finds nothing today.
