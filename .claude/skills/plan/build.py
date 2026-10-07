#!/usr/bin/env python3
"""Build and maintain the plan: docs/plan/ (source) -> docs/plan.html (generated).

Run from the project root. Stdlib only.

    python .claude/skills/plan/build.py                 build docs/plan.html
    python .claude/skills/plan/build.py --init          copy starter/ to docs/plan/ if missing, then build
    python .claude/skills/plan/build.py --check         validate only (errors and quality warnings)
    python .claude/skills/plan/build.py --status        compact digest: progress, what is ready to decide, open questions
    python .claude/skills/plan/build.py --apply [FILE]  save picks from the page: pasted text or the .json from Save .json ('-' reads stdin; no FILE finds docs/plan/picks.json or the newest Downloads/plan-picks*.json)
    python .claude/skills/plan/build.py --reopen F24 ..  remove the saved decision from those cards

The generated HTML is for humans. Agents edit the source files and use --status instead of reading the page.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE / "viewer"


def read(p):
    return Path(p).read_text(encoding="utf-8")


def load_json(p, default):
    p = Path(p)
    return json.loads(read(p)) if p.exists() else default


def dump_json(p, obj):
    Path(p).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def parts(d):
    """Markdown or HTML fragments in a folder. The first line carries the title."""
    out = []
    d = Path(d)
    if not d.exists():
        return out
    for f in sorted(d.iterdir()):
        if f.suffix not in (".md", ".html"):
            continue
        lines = read(f).split("\n")
        first = lines[0].strip()
        if f.suffix == ".md" and first.startswith("# "):
            title, body = first[2:].strip(), "\n".join(lines[1:])
        elif f.suffix == ".html" and first.startswith("<!-- title:"):
            title, body = first[len("<!-- title:"):].rstrip("->").strip(), "\n".join(lines[1:])
        else:
            title, body = f.stem, "\n".join(lines)
        out.append({"id": f.stem, "title": title, "kind": f.suffix[1:], "body": body})
    return out


def choice_files(src):
    d = Path(src) / "choices"
    return sorted(d.glob("*.json")) if d.exists() else []


def collect(src):
    src = Path(src)
    choices = []
    for f in choice_files(src):
        choices.extend(load_json(f, []))
    return {
        "meta": load_json(src / "meta.json", {"title": "Plan", "iteration": 0, "updated": "", "phases": []}),
        "idea": read(src / "idea.md") if (src / "idea.md").exists() else "",
        "why": read(src / "why.md") if (src / "why.md").exists() else "",
        "made": load_json(src / "decisions-made.json", []),
        "saved_picks": (load_json(src / "plan-picks.json", {}) or {}).get("picks", {}),
        "questions": load_json(src / "questions.json", []),
        "log": load_json(src / "log.json", []),
        "flows": load_json(src / "flows.json", []),
        "choices": choices,
        "mockups": [{"id": f.stem, "src": read(f)} for f in sorted((src / "mockups").glob("*.txt"))] if (src / "mockups").exists() else [],
        "themes": load_json(src / "themes.json", []),
        "blueprints": parts(src / "blueprints"),
        "research": parts(src / "research"),
    }


def validate(data):
    errs, warns = [], []
    cs = data["choices"]
    ids = [c.get("id") for c in cs]
    byid = {c.get("id"): c for c in cs}
    phases = [p["id"] for p in data["meta"].get("phases", [])]
    for i in set(ids):
        if ids.count(i) > 1:
            errs.append("duplicate decision id " + str(i))
    for c in cs:
        cid = c.get("id", "?")
        opts = c.get("options", [])
        oids = [o.get("id") for o in opts]
        if not c.get("title"):
            errs.append(cid + ": missing title")
        if phases and c.get("phase") not in phases:
            errs.append("%s: unknown phase %r" % (cid, c.get("phase")))
        mids = {m["id"] for m in data.get("mockups", [])}
        for mid in c.get("mockups", []):
            if mid not in mids and mid not in ("themes", "layout"):
                errs.append("%s: unknown mockup %s" % (cid, mid))
        for n in c.get("needs", []):
            if n not in byid:
                errs.append("%s: needs unknown decision %s" % (cid, n))
            elif phases and c.get("phase") in phases and byid[n].get("phase") in phases and phases.index(byid[n]["phase"]) > phases.index(c["phase"]):
                warns.append("%s: needs %s from a later phase" % (cid, n))
        if not opts or len(oids) != len(set(oids)):
            errs.append(cid + ": options missing or duplicate ids")
            continue
        dec = c.get("decided")
        if dec:
            bad = [x for x in dec.get("options", []) if x not in oids]
            if bad:
                errs.append("%s: decided option(s) %s not in options" % (cid, bad))
            if not c.get("multi") and len(dec.get("options", [])) > 1:
                errs.append(cid + ": single-choice card has several decided options")
        recs = [o for o in opts if o.get("rec")]
        imp = c.get("impact", 1)
        if not c.get("ask"):
            warns.append(cid + ": no ask")
        if len(opts) < 2:
            warns.append(cid + ": fewer than 2 options")
        if len(opts) > 6 and not c.get("multi"):
            warns.append(cid + ": more than 6 options on a single-choice card, consider splitting")
        if not c.get("multi") and len(recs) != 1:
            warns.append("%s: single-choice card should have exactly one recommended option (has %d)" % (cid, len(recs)))
        for op in opts:
            if op.get("must"):
                if not isinstance(op["must"], (str, bool)):
                    errs.append("%s: option %s: must should be a reason string or true" % (cid, op.get("id")))
                if not op.get("rec"):
                    warns.append("%s: option %s is must use but not recommended" % (cid, op.get("id")))
                if op["must"] is True or not str(op["must"]).strip():
                    warns.append("%s: option %s is must use without a reason" % (cid, op.get("id")))
        crit_ids = {x.get("id") for x in c.get("criteria", [])}
        for op in opts:
            for k, v in (op.get("scores") or {}).items():
                if k not in crit_ids:
                    errs.append("%s/%s: score for unknown criterion %s" % (cid, op.get("id"), k))
                elif not isinstance(v, int) or not 1 <= v <= 5:
                    errs.append("%s/%s: score %s must be an integer 1 to 5" % (cid, op.get("id"), k))
        if imp >= 2 and not c.get("why"):
            warns.append(cid + ": impact %d without a why" % imp)
        if imp == 3 and not c.get("multi"):
            if not c.get("rec_reason"):
                warns.append(cid + ": impact 3 without rec_reason")
            thin = [o["id"] for o in opts if not (o.get("pros") and o.get("cons") and o.get("pick_if"))]
            if thin:
                warns.append("%s: impact 3, options without pros/cons/pick_if: %s" % (cid, ", ".join(thin)))
    for i, qq in enumerate(data.get("questions", [])):
        if qq.get("status") == "closed":
            continue
        if not qq.get("rec"):
            warns.append("question %d has no recommendation: %s" % (i, qq.get("text", "")[:50]))
        for cid in qq.get("cards", []):
            if cid not in byid:
                errs.append("question %d relates to unknown decision %s" % (i, cid))
    # cycles in needs
    state = {}

    def visit(n, stack):
        if state.get(n) == 2:
            return
        if state.get(n) == 1:
            errs.append("needs cycle: " + " -> ".join(stack[stack.index(n):] + [n]))
            return
        state[n] = 1
        for m in byid.get(n, {}).get("needs", []):
            if m in byid:
                visit(m, stack + [n])
        state[n] = 2

    for n in byid:
        visit(n, [])
    return errs, warns


def report(errs, warns, cap=20):
    for e in errs:
        print("ERROR:", e)
    for w in warns[:cap]:
        print("warn:", w)
    if len(warns) > cap:
        print("warn: ... and %d more (run --check for the full list)" % (len(warns) - cap))


def build(src, out):
    data = collect(src)
    errs, warns = validate(data)
    report(errs, warns, cap=8)
    if errs:
        return 1
    css_files = [VIEWER / "style.css"] + sorted(VIEWER.glob("style-*.css"))
    style = "\n".join(read(f) for f in css_files)
    script = "\n".join(read(f) for f in sorted((VIEWER / "js").glob("*.js")))
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = read(VIEWER / "shell.html")
    html = html.replace("__TITLE__", data["meta"].get("title", "Plan"))
    html = html.replace("/*__STYLE__*/", style).replace("/*__DATA__*/", "const PLAN = " + payload + ";").replace("/*__SCRIPT__*/", script)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(html, encoding="utf-8")
    print("built %s (%d KB): %d decisions, %d flows, %d blueprints, %d research, %d mockups, %d themes"
          % (out, len(html) // 1024, len(data["choices"]), len(data["flows"]), len(data["blueprints"]), len(data["research"]), len(data["mockups"]), len(data["themes"])))
    return 0


def status(src):
    data = collect(src)
    errs, warns = validate(data)
    cs = data["choices"]
    byid = {c["id"]: c for c in cs}
    done = lambda c: bool(c.get("decided"))
    ready = [c for c in cs if not done(c) and all(done(byid[n]) for n in c.get("needs", []) if n in byid)]
    unlocks = {}
    for c in cs:
        for n in c.get("needs", []):
            unlocks[n] = unlocks.get(n, 0) + 1
    ready.sort(key=lambda c: (-c.get("impact", 1), -unlocks.get(c["id"], 0)))
    m = data["meta"]
    print("%s | iteration %s | updated %s | phase %s" % (m.get("title"), m.get("iteration"), m.get("updated"), m.get("phase", "")))
    print("Decisions: %d total, %d saved-decided, %d open (picks made only in the browser are not counted until pasted back)" % (len(cs), sum(map(done, cs)), len(cs) - sum(map(done, cs))))
    for p in m.get("phases", []):
        ds = [c for c in cs if c.get("phase") == p["id"]]
        print("  %-28s %d/%d" % (p["title"], sum(map(done, ds)), len(ds)))
    print("Ready to decide (impact, unlocks):")
    for c in ready[:8]:
        print("  %s %s  [%d, %d]" % (c["id"], c["title"], c.get("impact", 1), unlocks.get(c["id"], 0)))
    openq = [q for q in data["questions"] if q.get("status") != "closed"]
    musts = [(c["id"], op["id"]) for c in cs for op in c.get("options", []) if op.get("must")]
    print("Must use: %d options on %d cards" % (len(musts), len({m[0] for m in musts})))
    norec = [qq for qq in openq if not qq.get("rec")]
    print("Open questions: %d (%d without a recommendation) | Settled entries: %d | Flows: %d | Blueprints: %d | Research: %d" % (len(openq), len(norec), len(data["made"]), len(data["flows"]), len(data["blueprints"]), len(data["research"])))
    print("Check: %d errors, %d warnings" % (len(errs), len(warns)))
    return 1 if errs else 0


LINE = re.compile(r'^-\s*(\S+)\s+"(.*?)"\s*=>\s*\[([^\]]*)\](.*)$')


def find_picks_file(src):
    import glob
    cands = [os.path.join(str(src), "plan-picks.json"), os.path.join(str(src), "picks.json")]
    cands += glob.glob(os.path.join(os.path.expanduser("~"), "Downloads", "plan-picks*.json"))
    cands = [c for c in cands if os.path.isfile(c)]
    return max(cands, key=os.path.getmtime) if cands else None


def apply_picks(src, source):
    if source == "AUTO":
        source = find_picks_file(src)
        if not source:
            print("no picks file found: save one from the page (Save .json) into docs/plan/picks.json or your Downloads folder")
            return 1
        print("using", source)
    text = sys.stdin.read() if source == "-" else read(source)
    picks = {}
    if text.lstrip().startswith("{"):
        try:
            obj = json.loads(text)
        except ValueError as e:
            print("invalid JSON:", e)
            return 1
        for cid, v in (obj.get("picks", obj) or {}).items():
            ids = [x for x in (v.get("options") or v.get("sel") or []) if isinstance(x, str)]
            if ids:
                picks[cid] = (ids, str(v.get("note", "")))
        text = ""
    for ln in text.splitlines():
        m = LINE.match(ln.strip())
        if not m:
            continue
        ids = [x.strip() for x in m.group(3).split(",") if x.strip()]
        note = ""
        nm = re.search(r"::\s*note:\s*(.*)$", m.group(4))
        if nm:
            note = nm.group(1).strip()
        if ids:
            picks[m.group(1)] = (ids, note)
    if not picks:
        print("no picks found (expected lines like: - F24 \"Title\" => [option-id])")
        return 1
    today = datetime.date.today().isoformat()
    applied, skipped, unknown = [], [], set(picks)
    for f in choice_files(src):
        arr = load_json(f, [])
        changed = False
        for c in arr:
            if c["id"] not in picks:
                continue
            unknown.discard(c["id"])
            ids, note = picks[c["id"]]
            valid = {o["id"] for o in c["options"]}
            bad = [x for x in ids if x not in valid]
            if bad or (not c.get("multi") and len(ids) > 1):
                skipped.append("%s (bad option ids %s or several picks on a single-choice card)" % (c["id"], bad))
                continue
            old = c.get("decided")
            if old and old.get("options") == ids and old.get("note", "") == note:
                continue
            c["decided"] = {"options": ids, "note": note, "date": today}
            applied.append(c["id"])
            changed = True
        if changed:
            dump_json(f, arr)
    print("applied %d: %s" % (len(applied), ", ".join(applied) or "-"))
    if skipped:
        print("skipped:", "; ".join(skipped))
    if unknown:
        print("unknown ids:", ", ".join(sorted(unknown)))
    return 0 if not skipped and not unknown else 1


def reopen(src, ids):
    left = set(ids)
    for f in choice_files(src):
        arr = load_json(f, [])
        changed = False
        for c in arr:
            if c["id"] in left and c.pop("decided", None) is not None:
                left.discard(c["id"])
                changed = True
        if changed:
            dump_json(f, arr)
    print("reopened:", ", ".join(i for i in ids if i not in left) or "-", ("| not decided or unknown: " + ", ".join(sorted(left))) if left else "")
    return 0


def serve(src, out, port):
    """Serve the built plan on localhost and let the page save its picks to <src>/plan-picks.json (fixed path)."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    picks_file = Path(src) / "plan-picks.json"
    page = Path(out)
    ok_hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code, body, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def host_ok(self):
            return self.headers.get("Host", "") in ok_hosts

        def do_GET(self):
            if not self.host_ok():
                return self.send(403, b"{}")
            if self.path.split("?")[0] in ("/", "/index.html", "/plan.html"):
                return self.send(200, page.read_bytes(), "text/html")
            if self.path.startswith("/api/picks"):
                body = picks_file.read_bytes() if picks_file.is_file() else b"{}"
                return self.send(200, body)
            return self.send(404, b"{}")

        def do_POST(self):
            if not self.host_ok() or self.path != "/api/picks" or self.headers.get("X-Plan") != "1":
                return self.send(403, b'{"error":"forbidden"}')
            n = int(self.headers.get("Content-Length", "0") or 0)
            if n <= 0 or n > 1024 * 1024:
                return self.send(400, b'{"error":"size"}')
            raw = self.rfile.read(n)
            try:
                obj = json.loads(raw.decode("utf-8"))
                if not isinstance(obj.get("picks"), dict):
                    raise ValueError("picks missing")
            except ValueError as e:
                return self.send(400, json.dumps({"error": str(e)}).encode())
            tmp = picks_file.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + chr(10), encoding="utf-8")
            tmp.replace(picks_file)
            return self.send(200, json.dumps({"saved": str(picks_file), "count": len(obj["picks"])}).encode())

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print("plan on http://127.0.0.1:%d/  (Save decisions writes %s; Ctrl+C stops)" % (port, picks_file))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description="Build and maintain the plan.")
    ap.add_argument("--src", default="docs/plan")
    ap.add_argument("--out", default="docs/plan.html")
    ap.add_argument("--init", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--apply", metavar="FILE", nargs="?", const="AUTO")
    ap.add_argument("--reopen", nargs="+", metavar="ID")
    ap.add_argument("--serve", nargs="?", type=int, const=8765, metavar="PORT")
    a = ap.parse_args(argv)
    src = Path(a.src)
    if a.init and not src.exists():
        shutil.copytree(HERE / "starter", src)
        print("created", src)
    if not src.exists():
        print("no source folder %s (run with --init)" % src)
        return 1
    if a.check:
        errs, warns = validate(collect(src))
        report(errs, warns, cap=10 ** 6)
        print("ok" if not errs and not warns else "%d errors, %d warnings" % (len(errs), len(warns)))
        return 1 if errs else 0
    if a.status:
        return status(src)
    if a.serve:
        rc = build(src, a.out)
        return rc or serve(src, a.out, a.serve)
    if a.apply:
        rc = apply_picks(src, a.apply)
        return max(rc, build(src, a.out))
    if a.reopen:
        reopen(src, a.reopen)
        return build(src, a.out)
    return build(src, a.out)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
