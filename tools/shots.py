#!/usr/bin/env python3
"""Capture the screenshots the README shows.

    ./.venv/bin/python tools/shots.py

Writes docs/sign-on.png and docs/im-window.png from the real page (not a mock),
with the advisor API stubbed so the transcript shows a plausible exchange.
"""
import http.server
import json
import pathlib
import socket
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs"
OUT.mkdir(exist_ok=True)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass


def serve():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % port


def main():
    httpd, base = serve()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_context(viewport={"width": 1100, "height": 760}).new_page()
            page.route("**/api/parent/chat", lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps({
                    "answer": ("The first 90 days are mostly audiology, early intervention and "
                               "language at home. Get the hearing evaluation in writing, ask for "
                               "an IFSP referral before age three, and start signing with your "
                               "child today rather than waiting for a prognosis."),
                    "sources": ["Notes/First 90 Days After Diagnosis.md"],
                    "citations": [{
                        "title": "Language and brain development in deaf children",
                        "url": "https://doi.org/10.1093/deafed/enz012",
                    }],
                })))
            page.goto(base + "/", wait_until="load")
            page.wait_for_selector("#signon", state="visible")
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / "sign-on.png"))

            page.fill("#snInput", "VisitingParent")
            page.click("#signOnBtn")
            page.wait_for_selector("#imwin", state="visible")
            page.fill("#chatInput", "my daughter just failed her hearing test, what now")
            page.click("#sendBtn")
            page.wait_for_timeout(9000)
            page.screenshot(path=str(OUT / "im-window.png"))
            browser.close()
    finally:
        httpd.shutdown()
    print("wrote", OUT / "sign-on.png", OUT / "im-window.png")


if __name__ == "__main__":
    main()
