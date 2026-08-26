# The runner

Two runners exist while the runner moves off bash. `bin/lm` ships; `bin/lm-next` is the Node one
being built beside it. Both read the same registry, so a tool file does not know which one
called it.

`lm-next` serves `--list`, `--help` and the argument handling, and stops with a message where
the model call would be. Its usage line names `lm`, not `lm-next`, because that is the command
it becomes when the shell runner goes away.

Node runs the TypeScript directly: no build step, no dependency, and `.tool-versions` pins the
version that does it. `package.json` exists only to make the extensionless executable in `bin/`
load as a module.

## The bridge to a bash tool

A tool file is a set of shell function definitions, not a program. The Node runner sources it in
a `bash` process and calls one function, then does that again, in a new process, for the next
call. One process per call is what keeps a tool from leaking state into the runner or into the
next call; `bin/lm` gets the same isolation for `list()` from a subshell.

`src/registry.mts`:

| Export | What it does |
| --- | --- |
| `list(dir)` | The index: the `*.sh` files in `dir`, sorted. Adding a tool changes no file here. |
| `meta(file)` | The declared `name`, `description` and `flags`. |
| `call(file, fn, opts)` | Calls one function. `opts` carries `args`, `stdin`, `cwd` and `env`. |

A call returns `stdout`, `stderr` and `status`, and the status is the shell function's own: a
tool refusing with `return 3` is telling the runner there is nothing to work on, and that has to
survive the trip.

`meta` separates its fields with a NUL rather than a tab, because a description is prose written
for the router and prose may contain a tab.

## What the bridge does not do

`apply` is not callable through it. `apply` is the only one of the five functions that calls
`confirm`, `confirm` reads `/dev/tty`, and which process owns the terminal once a harness is in
the loop is unsettled.

`confirm` is still defined, because a tool is entitled to assume its runner provides the name.
It prints why it is unavailable and `exit`s rather than returning: no tool tests what `confirm`
returned, since `apply()` in every tool file puts the side effect on the next line, so a
`return` performs the effect the refusal was meant to prevent. The code it leaves is
deliberately none of the ones in [`verbs.md`](verbs.md) — borrowing 7 would tell `lm-stats` a
human declined.

## Arguments

`src/args.mts` holds the rules `bin/lm` applies by scanning, so a flag and free text coexist in
either order: `--dry-run` belongs to the runner, `--` makes everything after it text, a flag the
tool declared in `flags` arrives as `LM_<NAME>` with `-` becoming `_`, and anything else that
looks like a flag is a typo and refused. A typo must not reach the prompt as words.

No shipped tool declares a flag, so the differential tests below cannot reach that path through
either binary and it is covered against the parser directly.

## Tests

```bash
node tests/registry.mts       # the bridge, against bash itself
node tests/args.mts           # lm-next against bin/lm, plus the parser alone
```

Every case is differential: `bin/lm` reads the same registry through a sourced subshell, so
while it is here it is the oracle, and a case names the bytes bash produces and requires the
same ones back. A case asserting only that the bridge returned something would pass on a bridge
that dropped a field.

The four `schema matches bash` cases do **not** prove `cwd` is passed through. The test process
already stands in the repository and a child inherits it, so removing `cwd` from the bridge
leaves all four green; the case that tests it runs against a temporary directory. That was found
by perturbing the bridge, not by reading it.

No dependency and no build step: Node strips the types and runs the file, and `.tool-versions`
pins the version that does. `node --check` is this half of the repository's `bash -n` — run it
on a mutant before believing what the mutant killed, and confirm it rejects a deliberately
broken file first.
