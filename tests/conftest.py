"""Playwright fixtures: serve the site, and stub the advisor API.

The page is a static single-page app that talks to one endpoint. Tests serve it
over HTTP (file:// changes fetch and CORS behaviour) and stub the endpoint with
page.route so a test never depends on the live advisor, a model, or the network.

A fixture named `page` is deliberately avoided: pytest-playwright owns that
name, and shadowing it produces a recursive-dependency error.
"""
import http.server
import json
import os
import socket
import threading

import pytest
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the repo root without printing a line per asset.

    It also sends the deploy's Content-Security-Policy as a header, because a
    CSP violation is exactly the kind of breakage a headless test should catch.
    The live site carries the same policy as a meta tag in index.html (GitHub
    Pages cannot send headers); app.py sends it as a header.
    """

    CSP = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self' data:; "
        "connect-src 'self' https://learnwithclay.ai; frame-ancestors 'self'; "
        "object-src 'none'; base-uri 'self'; form-action 'self'"
    )

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
    """Poll the DOM for a substring, from Python.

    page.wait_for_function() is not usable here: it evaluates a string inside
    the page, and the deploy's Content-Security-Policy (script-src 'self', no
    'unsafe-eval') blocks that. Polling inner_text keeps the tests under the
    same policy the site ships with.
    """
    import time

    deadline = time.time() + timeout
    needle = needle.lower()
    while time.time() < deadline:
        try:
            if needle in page.inner_text(selector).lower():
                return True
        except Exception:
            pass
        page.wait_for_timeout(250)
    raise AssertionError("timed out waiting for %r in %s" % (needle, selector))


def wait_for_text_change(page, selector, previous, timeout=15):
    """Poll until an element's text differs from `previous`.

    Same reason as wait_for_text: no in-page eval under this CSP.
    """
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if page.inner_text(selector) != previous:
                return True
        except Exception:
            pass
        page.wait_for_timeout(200)
    raise AssertionError("%s never changed away from %r" % (selector, previous))
