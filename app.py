#!/usr/bin/env python3
"""Python host for the Parent Advisor: AIM Edition page.

The page is a static single-page app: index.html (markup), assets/styles.css,
assets/app.js (behaviour) and i18n.js (the string table). There is no server
logic to port, so this module does the two jobs a static host must do: serve
the files, and send the same security headers the deploy carries, so a local
run cannot pass a check the deploy would fail.

Run:  python3 app.py            -> http://127.0.0.1:8020
      PORT=9000 python3 app.py
"""
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

import policy

ROOT = Path(__file__).resolve().parent

# The policy lives in security.json, shared with the test fixture and with the
# meta tag in index.html (GitHub Pages cannot send headers). See policy.py.
SECURITY_HEADERS = policy.HEADERS

app = FastAPI(title="Parent Advisor: AIM Edition", docs_url=None, redoc_url=None)


@app.get("/healthz", response_class=PlainTextResponse)
def healthz() -> str:
    return "ok\n"


@app.api_route("/", methods=["GET", "HEAD"], response_class=HTMLResponse)
def index() -> FileResponse:
    # Always revalidate the markup: it carries the page structure and the CSP
    # applies to it. GitHub Pages leaves its own caching to itself.
    headers = dict(SECURITY_HEADERS, **{"Cache-Control": "no-cache"})
    return FileResponse(ROOT / "index.html", media_type="text/html", headers=headers)


class HeaderedStatic(StaticFiles):
    """StaticFiles that also applies the security headers."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


app.mount("/", HeaderedStatic(directory=str(ROOT), html=False), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8020")),
        log_level="info",
    )
