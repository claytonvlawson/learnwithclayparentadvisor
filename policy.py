"""The security policy, read from one place.

`security.json` holds the headers. `app.py` sends them, `tests/conftest.py`
sends the Content-Security-Policy with every test request, and `index.html`
carries the same policy in a meta tag because GitHub Pages cannot send response
headers. Before this the policy was typed out three times and two of the three
copies carried a comment saying drift was the risk.

A meta policy cannot express `frame-ancestors`, so the meta variant is derived
here rather than maintained by hand.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(ROOT, "security.json")

with open(SOURCE, encoding="utf-8") as fh:
    _data = json.load(fh)

HEADERS = dict(_data["headers"])
CSP = HEADERS["Content-Security-Policy"]


def derive_meta_csp(csp: str) -> str:
    """The CSP as a meta tag can carry it: frame-ancestors and report-uri are
    header-only directives, so they are dropped and the rest is kept verbatim."""
    parts = [p.strip() for p in csp.split(";")]
    kept = [p for p in parts if p and not re.match(r"^(frame-ancestors|report-uri|sandbox)\b", p)]
    return "; ".join(kept)


META_CSP = derive_meta_csp(CSP)