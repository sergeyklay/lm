#!/usr/bin/env python3
"""Can the model partition a working tree into the commits a human made?

Not one of the suites: this one calls the model and needs a reference repository,
so it is run by hand when the question is asked again, not on every change.

  python3 tests/partition-rate.py 24            # no intent text
  INTENT=1 OUT=/tmp/i.jsonl python3 tests/partition-rate.py 24

Reference: a pair of real commits from ~/work/sortie that touch disjoint file
sets. The synthetic tree holds both changes at once; the human's partition is
the pair itself. The model sees the file list as a closed set and the diff.
"""
import json, subprocess, tempfile, pathlib, os, sys, time

S = os.path.expanduser("~/work/sortie")
OUT = pathlib.Path(os.environ.get("OUT", "/tmp/part/results.jsonl"))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 24
MODEL = "qwen3.8:27b"


def git(repo, *a, binary=False):
    r = subprocess.run(["git", "-C", repo, *a], capture_output=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def build(a, b, fa, fb, d):
    """A repo whose staged diff is exactly the two commits' changes combined."""
    subprocess.run(["git", "init", "-q", "-b", "main", d], capture_output=True)
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        subprocess.run(["git", "-C", d, "config", k, v], capture_output=True)

    def write(rev, path):
        blob = git(S, "show", f"{rev}:{path}", binary=True)
        p = pathlib.Path(d, path)
        if not blob and subprocess.run(["git", "-C", S, "cat-file", "-e", f"{rev}:{path}"],
                                       capture_output=True).returncode:
            if p.exists():
                p.unlink()
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(blob)

    for rev, fs in ((a + "^", fa), (b + "^", fb)):
        for f in fs:
            write(rev, f)
    subprocess.run(["git", "-C", d, "add", "-A"], capture_output=True)
    subprocess.run(["git", "-C", d, "commit", "-qm", "base"], capture_output=True)
    for rev, fs in ((a, fa), (b, fb)):
        for f in fs:
            write(rev, f)
    subprocess.run(["git", "-C", d, "add", "-A"], capture_output=True)
    return git(d, "diff", "--cached"), git(d, "diff", "--cached", "--name-only").split()


def ask(files, diff, intent=""):
    prompt = "\n".join([
        *(["The person running this described the work as follows. Treat it as what they",
           "meant, not as wording to copy:", intent, ""] if intent else []),
        "Changed files:", *files, "",
        "Diff:", diff[:20000], "",
        "Split these changes into commits. One commit per independent change: a change is",
        "independent when it could be reverted on its own without breaking the others.",
        "Every file listed above must appear in exactly one commit, and no other file may",
        "appear. Give each commit a Conventional Commits subject.",
    ])
    schema = {"type": "object", "properties": {"groups": {"type": "array", "minItems": 1,
              "items": {"type": "object", "properties": {
                  "subject": {"type": "string"},
                  "files": {"type": "array", "items": {"type": "string", "enum": files}}},
                  "required": ["subject", "files"]}}}, "required": ["groups"]}
    body = {"model": MODEL, "stream": False, "think": False,
            "messages": [{"role": "user", "content": prompt}], "format": schema,
            "options": {"num_ctx": 32768, "num_predict": 2000, "temperature": 0},
            "keep_alive": "30m"}
    r = subprocess.run(["curl", "-sS", "-m", "600", "http://127.0.0.1:11434/api/chat",
                        "-d", "@-"], input=json.dumps(body).encode(), capture_output=True)
    return json.loads(r.stdout)["message"]["content"]


sample = json.loads(pathlib.Path(__file__).with_name("partition-sample.json").read_text())
done = 0
for a, b, fa, fb in sample:
    if done >= N:
        break
    with tempfile.TemporaryDirectory() as d:
        diff, seen = build(a, b, fa, fb, d)
        if sorted(seen) != sorted(fa + fb) or not diff:
            continue                      # the tree did not reconstruct; not a data point
        intent = ""
        if os.environ.get("INTENT"):
            intent = "; ".join(git(S, "log", "-1", "--format=%s", r).strip() for r in (a, b))
        t0 = time.time()
        try:
            ans = json.loads(ask(sorted(seen), diff, intent))
        except Exception as e:
            rec = {"a": a, "b": b, "error": str(e)[:200]}
            OUT.open("a").write(json.dumps(rec) + "\n")
            done += 1
            continue
        groups = [frozenset(g.get("files", [])) for g in ans.get("groups", [])]
        flat = [f for g in groups for f in g]
        rec = {"a": a, "b": b, "ms": int((time.time() - t0) * 1000),
               "ref": [sorted(fa), sorted(fb)],
               "got": [sorted(g) for g in groups],
               "subjects": [g.get("subject", "") for g in ans.get("groups", [])],
               "partition_valid": sorted(flat) == sorted(seen),
               "exact": set(groups) == {frozenset(fa), frozenset(fb)},
               # A refinement splits finer than the human but never mixes the two
               # changes; that is a different error from putting them in one commit.
               "refines": all(g <= frozenset(fa) or g <= frozenset(fb) for g in groups),
               "merged": len(groups) == 1,
               "ngroups": len(groups)}
        OUT.open("a").write(json.dumps(rec) + "\n")
        done += 1
        print(f"{done:2d}/{N} exact={rec['exact']} valid={rec['partition_valid']} "
              f"groups={rec['ngroups']} ref=2 {rec['ms']}ms", flush=True)
print("done", done)
