"""The uptime probe: does it pass on a good deploy and fail on a bad one.

The check is a shell script because a workflow step you cannot run locally is a
step you find out about four hours later. These tests run it against a real
HTTP server over the staged site, then against the same site with a source file
put back in it.
"""
import http.server
import os
import socket
import subprocess
import threading

import pytest

from conftest import ROOT

SCRIPT = os.path.join(ROOT, "tools", "check_live.sh")


def stage(tmp_path):
    out = tmp_path / "site"
    subprocess.run(["sh", os.path.join(ROOT, "tools", "stage_site.sh"), str(out)],
                   check=True, capture_output=True)
    return out


@pytest.fixture
def served(tmp_path):
    """Serve a directory over HTTP the way a static host does."""
    root = stage(tmp_path)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(root), **k)

        def log_message(self, *a):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield "http://127.0.0.1:%d" % port, root
    finally:
        httpd.shutdown()
        httpd.server_close()


def run(base_url):
    return subprocess.run(["sh", SCRIPT], capture_output=True, text=True,
                          env=dict(os.environ, BASE_URL=base_url), timeout=120)


def test_the_probe_passes_on_the_staged_site(served):
    base_url, _ = served
    result = run(base_url)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "FAIL" not in result.stdout
    assert "ok   404 /app.py" in result.stdout


def test_the_probe_fails_when_the_repository_is_published(served):
    base_url, root = served
    # put the source back, the way the un-staged deploy had it
    (root / "app.py").write_text("# source\n", encoding="utf-8")
    result = run(base_url)
    assert result.returncode == 1
    assert "FAIL 200 /app.py" in result.stdout, result.stdout


def test_the_probe_fails_when_a_file_is_missing(served):
    base_url, root = served
    (root / "i18n.js").unlink()
    result = run(base_url)
    assert result.returncode == 1
    assert "FAIL 404 /i18n.js" in result.stdout, result.stdout


def test_the_probe_covers_every_staged_file():
    # A new asset that the probe does not check is an asset that can vanish
    # without anyone hearing about it.
    script = open(SCRIPT, encoding="utf-8").read()
    workflow = open(os.path.join(ROOT, ".github", "workflows", "pages.yml"), encoding="utf-8").read()
    assert "tools/stage_site.sh" in workflow

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "site")
        subprocess.run(["sh", os.path.join(ROOT, "tools", "stage_site.sh"), out],
                       check=True, capture_output=True)
        staged = []
        for dirpath, _, names in os.walk(out):
            for name in names:
                rel = os.path.relpath(os.path.join(dirpath, name), out)
                staged.append("/" + rel.replace(os.sep, "/"))
    # the language tables are covered by the one Spanish table plus the count
    unchecked = [p for p in staged if p != "/.nojekyll" and not p.startswith("/i18n/")
                 and p not in script]
    assert unchecked == [], "the probe does not check %r" % unchecked


def test_the_uptime_workflow_is_scheduled_and_reports():
    workflow = open(os.path.join(ROOT, ".github", "workflows", "uptime.yml"), encoding="utf-8").read()
    assert "cron:" in workflow, "the probe has no schedule"
    assert "tools/check_live.sh" in workflow
    assert "if: failure()" in workflow
    assert "gh issue create" in workflow
    assert "issues: write" in workflow


def test_the_readme_documents_the_check():
    readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    assert "check_live.sh" in readme