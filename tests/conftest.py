"""Playwright fixtures: serve the site, and stub the advisor API.

The page is a static single-page app that talks to one endpoint. Tests serve it
over HTTP (file:// changes fetch and CORS behaviour) and stub the endpoint with
page.route so a test never depends on the live advisor, a model, or the network.

A fixture named `page` is deliberately avoided: pytest-playwright owns that
name, and shadowing it produces a recursive-dependency error.
"""
import http.server
import importlib.util
import json
import os
import socket
import threading

import pytest
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# One source for the policy: security.json, read through policy.py, so the test
# server, app.py and the meta tag in index.html cannot drift apart.
_spec = importlib.util.spec_from_file_location("pa_policy", os.path.join(ROOT, "policy.py"))
_policy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_policy)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the repo root without printing a line per asset.

    It also sends the deploy's Content-Security-Policy as a header, because a
    CSP violation is exactly the kind of breakage a headless test should catch.
    The live site carries the same policy as a meta tag in index.html (GitHub
    Pages cannot send headers); app.py sends it as a header.
    """

    CSP = _policy.CSP

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Content-Security-Policy", self.CSP)
        super().end_headers()

    def log_message(self, format, *args):  # noqa: A002 - base class signature
        pass


@pytest.fixture(scope="session")
def base_url():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), QuietHandler)
    httpd.daemon_threads = True
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:%d" % port
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            yield browser
        finally:
            browser.close()


@pytest.fixture
def app_page(browser, base_url):
    """A page that has loaded the site, with console errors collected."""
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(base_url + "/", wait_until="load")
    page.console_errors = errors
    try:
        yield page
    finally:
        context.close()


@pytest.fixture
def stub_advisor(app_page):
    """Replace /api/parent/chat with a canned answer.

    Returns the list of request bodies the page sent, so a test can assert what
    the front end actually put on the wire.
    """
    sent = []

    def handler(route):
        try:
            sent.append(json.loads(route.request.post_data or "{}"))
        except ValueError:
            sent.append({})
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "answer": "Stubbed answer: the first 90 days are about audiology.",
                "sources": ["Notes/First 90 Days After Diagnosis.md"],
                "citations": [{
                    "title": "Language and brain development in deaf children",
                    "url": "https://doi.org/10.1093/deafed/enz012",
                }],
            }),
        )

    app_page.route("**/api/parent/chat", handler)
    return sent


def sign_on(page):
    """Walk the sign-on dialog the way a visitor does."""
    page.fill("#snInput", "TestParent")
    page.click("#signOnBtn")
    page.wait_for_selector("#imwin", state="visible", timeout=10000)


def wait_for_text(page, needle, timeout=30, selector="body"):
    """Wait until a substring appears in a selector's text.

    This is page.wait_for_function, which is not blocked by the CSP: Chromium's
    devtools evaluation is exempt, which is also why page.evaluate works in the
    paste tests. The earlier polling loop here worked around a limit that does
    not exist, and cost up to 45 s per failing assertion.
    """
    try:
        page.wait_for_function(
            "([sel, needle]) => {"
            "  const el = document.querySelector(sel);"
            "  return !!el && (el.innerText || '').toLowerCase().includes(needle);"
            "}",
            arg=[selector, needle.lower()],
            timeout=int(timeout * 1000),
        )
    except PlaywrightTimeoutError:
        body = ""
        try:
            body = page.inner_text(selector)[:400]
        except Exception:
            pass
        raise AssertionError("timed out waiting for %r in %s; text was %r" % (needle, selector, body))
    return True


def wait_for_text_change(page, selector, previous, timeout=15):
    """Wait until an element's text differs from `previous`."""
    try:
        page.wait_for_function(
            "([sel, prev]) => {"
            "  const el = document.querySelector(sel);"
            "  return !!el && el.innerText !== prev;"
            "}",
            arg=[selector, previous],
            timeout=int(timeout * 1000),
        )
    except PlaywrightTimeoutError:
        raise AssertionError("%s never changed away from %r" % (selector, previous))
    return True
