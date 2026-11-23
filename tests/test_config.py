"""Config that has to agree with itself: the security policy and the pins.

These are static checks, so they run in milliseconds and catch the drift that
the page itself cannot show: a policy edited in one file and not the others, or a
dependency that CI floats while the claim is that the suite is reproducible.
"""
import importlib.util
import json
import os
import re

from conftest import ROOT

_spec = importlib.util.spec_from_file_location("pa_policy", os.path.join(ROOT, "policy.py"))
policy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(policy)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return fh.read()


# --- one policy, three consumers ---------------------------------------------

def test_the_source_file_holds_every_header():
    data = json.loads(read("security.json"))
    assert set(data["headers"]) >= {
        "Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options",
        "Referrer-Policy", "Permissions-Policy",
    }
    assert "default-src 'self'" in data["headers"]["Content-Security-Policy"]


def test_the_python_host_sends_the_source_policy():
    src = read("app.py")
    assert "SECURITY_HEADERS = policy.HEADERS" in src
    assert "default-src" not in src, "app.py still restates the policy inline"


def test_the_test_server_sends_the_source_policy():
    src = read("tests/conftest.py")
    assert "CSP = _policy.CSP" in src
    assert "default-src" not in src, "conftest.py still restates the policy inline"


def test_the_meta_tag_matches_the_policy_minus_the_header_only_directives():
    html = read("index.html")
    m = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', html)
    assert m, "index.html has no CSP meta tag"
    assert m.group(1) == policy.META_CSP
    assert "frame-ancestors" not in m.group(1), "frame-ancestors is ignored in a meta policy"
    assert "frame-ancestors 'self'" in policy.CSP, "the header form should keep frame-ancestors"


def test_the_meta_policy_still_covers_the_dangerous_directives():
    # A meta policy silently ignores unsupported directives, so the ones that
    # stop injected script and plugin content have to be present by name.
    for directive in ("script-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"):
        assert directive in policy.META_CSP, directive
    assert "unsafe-eval" not in policy.META_CSP
    assert "script-src 'self' 'unsafe-inline'" not in policy.META_CSP


# --- pinned dependencies ------------------------------------------------------

def _requirements():
    out = []
    for line in read("requirements-dev.txt").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        name = re.split(r"[<>=!~\[ ]", line, 1)[0]
        out.append((name, line))
    return out


def _constraints():
    pins = {}
    for line in read("constraints.txt").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.match(r"^([A-Za-z0-9_.-]+)==([^\s]+)$", line)
        assert m, "constraints.txt line is not an exact pin: %r" % line
        pins[m.group(1).lower()] = m.group(2)
    return pins


def test_every_runtime_dependency_is_pinned_exactly():
    pins = _constraints()
    missing = [name for name, line in _requirements() if name.lower() not in pins]
    assert missing == [], "unpinned in constraints.txt: %r" % missing


def test_ci_installs_the_pins():
    workflow = read(".github/workflows/tests.yml")
    assert "-c constraints.txt" in workflow, "CI does not apply the constraints file"
    assert "cache-dependency-path: requirements-dev.txt" in workflow


def test_the_constraints_file_is_not_empty_drift():
    # Every pin should name a real version, and nothing should be pinned that is
    # not asked for: a constraint for a package nobody installs is noise.
    pins = _constraints()
    asked = {name.lower() for name, _ in _requirements()}
    assert set(pins) <= asked, "constraints for packages not in requirements-dev.txt: %r" % (set(pins) - asked)
    for name, version in pins.items():
        assert re.match(r"^\d+\.\d+", version), (name, version)


# --- repository hygiene that a reviewer checks --------------------------------

# Two files quote the needles on purpose: this check, which has to name the
# patterns, and the review that publishes the command that looks for them.
HOME_PATH_ALLOWED = {"tests/test_config.py", "docs/REVIEW.md"}


def test_no_absolute_home_paths_are_committed():
    offenders = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in {".git", ".venv", "node_modules", ".netlify", ".pytest_cache"}]
        for name in filenames:
            path = os.path.join(dirpath, name)
            if os.path.getsize(path) > 400_000 or name.endswith((".png", ".jpg", ".zip")):
                continue
            try:
                text = open(path, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            rel = os.path.relpath(path, ROOT)
            if rel in HOME_PATH_ALLOWED:
                continue
            for needle in ("/Users/", "/home/", "/root/"):
                if needle in text:
                    offenders.append(rel)
    assert offenders == [], offenders


# --- the deploy ships the site, not the repository ----------------------------

def test_the_staged_site_is_only_the_page(tmp_path):
    import subprocess

    out = tmp_path / "site"
    subprocess.run(["sh", os.path.join(ROOT, "tools", "stage_site.sh"), str(out)],
                   check=True, capture_output=True)
    staged = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())

    expected = {".nojekyll", "index.html", "aol-figure.png", "win-flag.png",
                "assets/app.js", "assets/styles.css", "docs/im-window.png"}
    expected |= {"i18n/" + name for name in os.listdir(os.path.join(ROOT, "i18n"))}
    assert set(staged) == expected, {
        "unexpected": sorted(set(staged) - expected),
        "missing": sorted(expected - set(staged)),
    }

    # the things that should never be public again
    for leaked in ("app.py", "tests", "README.md", "requirements-dev.txt", "security.json", "tools"):
        assert not (out / leaked).exists(), leaked


def test_the_pages_workflow_uses_the_staging_script():
    workflow = read(".github/workflows/pages.yml")
    assert "tools/stage_site.sh" in workflow
    assert "actions/deploy-pages" in workflow
    # a workflow that starts copying the repo root defeats the point
    assert "path: ." not in workflow and "path: ./" not in workflow
