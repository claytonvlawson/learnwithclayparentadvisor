# Code review: Parent Advisor, AIM Edition

Reviewed `main` at `3877406` on 22 November 2026. Everything below is backed by
a command that was actually run; the evidence line says which.

Verdict: this is a well kept repo. The suite passes, the CSP is real, the
sanitizer already handles the nested-node case, and no absolute home path ships
in any tracked file. Three defects were real enough to fix in this PR (an
attribute-escaping hole, a double-send race, and an English-only crisis router).
What remains is deployment hygiene, payload weight, and test coverage, in that
order.

## What holds up

| Claim | Evidence |
|---|---|
| The page parses and the suite is green | `python -m pytest -q` -> 25 passed in 13.19s (20 before this PR) |
| Both scripts parse | `node --check assets/app.js && node --check i18n.js` |
| The Python host parses | `python3 -m py_compile app.py` |
| No home paths in tracked files | `git grep -n -e /Users/ -e /home/ -e /root/` returns nothing |
| The translation table has no holes | parsed with `json.JSONDecoder`: 209 UI keys and 5 canned blocks in all 17 non-English locales, identical template key sets |
| The CSP is enforced, not just declared | the suite runs behind the deploy policy in `tests/conftest.py` and reports no console errors |

## P0 (fixed in this PR)

### 1. API text was escaped for text, not for attributes

`renderCitations` interpolated a citation string into `title="..."` and a URL
into `href="..."` using `escapeHtml`, which goes through
`textContent -> innerHTML` and therefore leaves double quotes alone. A quote in
the response closed the attribute.

Evidence, from a probe before the fix: a citation carrying
`He said "this is a test" style="position:fixed;inset:0"` produced a `<li>`
whose attributes were `title=He said "`, `this=`, `is=`, `a=`, `test"=`,
`style=position:fixed;inset:0`. CSP does not stop that: `style-src` allows
`unsafe-inline`.

Fixed with `escapeAttr` (it escapes `& < > " '`) at both attribute sites.
`tests/test_review_fixes.py::test_citation_text_cannot_add_attributes` fails
before the fix and passes after.

Acceptance criteria: a `<li>` in the citation list carries no attribute other
than `title`; the citation text survives verbatim inside it.

### 2. One conversation could run two questions at once

The Send button is disabled while a request is in flight, but the Enter key in
the composer and the suggestion chips do not go through the button, and `ask`
had no guard of its own. Two Enters gave two requests, two answers, the typing
row removed from under the first request, and Send re-enabled while the first
response was still out (`requests_sent: 2`, `sendBtn.disabled: false`).

Fixed with an `inFlight` flag set in `ask` and cleared on every exit path, a
class instead of a duplicate `id="typing"` for the typing row, and a reset in
`logOff`. Test: `test_second_question_is_ignored_while_one_is_in_flight`.

Acceptance criteria: while a request is pending, a second Enter sends nothing,
Send stays disabled, and exactly one answer appears.

### 3. The crisis router only spoke English

`CRISIS_PATTERNS` is English, and it is the only safety router on the client. It
runs exactly when the backend cannot be reached, which is the case the fallback
exists for. The UI offers 18 languages. A Spanish "quiero morir, ya no aguanto"
with the API aborted returned the generic preview answer ("Prueba una de las
preguntas de ejemplo..."), not the crisis block.

Fixed by adding a per-language trigger set (`CRISIS_I18N`) for all 17
non-English locales, checked before the topic routes. False positives show
resources, which is the safe direction; a miss is not.

Tests: `test_spanish_crisis_question_reaches_the_crisis_route`,
`test_chinese_crisis_question_reaches_the_crisis_route`, and
`test_english_crisis_question_still_reaches_the_crisis_route` as the guard that
the original path still fires.

Acceptance criteria: a suicide disclosure in any shipped language reaches the
988 block with the API down.

## P1 (open, one issue each)

4. **Resolved.** **`i18n.js` shipped 359 KB raw / 85 KB gzipped to every visitor**, and was
   parsed before `app.js`. That is 39 percent of the page's gzipped weight
   (578 KB raw, 217 KB gz measured with `gzip -9`) for a reader who needs none
   of it. The table is now `i18n/<code>.js`, fetched on selection; English loads
   nothing. English first paint is 36 KB gzipped against 115 KB, and
   `tests/test_i18n_payload.py` holds the behaviour.
5. **Images.** `aol-figure.png` is 328x360 and 82 KB to paint a 30x33 logo
   (about 2 KB re-exported at 2x). `aim-logo.png` (20 KB) has zero references
   in the repo. `win-flag.png` is fine.
6. **The deploy publishes the repository, not the site.** GitHub Pages serves
   the root as-is, and the retired Netlify project set `publish = "."`:
   `curl -o /dev/null -w "%{http_code}" .../app.py` -> 200, and the same for
   `tests/test_chat.py`. `app.py` has the same shape: `StaticFiles(directory=ROOT)`
   serves everything under the root, so `HOST=0.0.0.0` publishes `.git/config`.
   A `public/` publish directory, or an extension allowlist in `app.py`, closes it.
7. **Resolved by retiring Netlify.** The live URL
   `https://learnwithclayparentadvisor.netlify.app/` returns 503
   `{"error":"usage_exceeded"}`. GitHub Pages is now the only deploys target, so
   the dead link is gone; an uptime check is still worth adding, because nothing
   in the repo would report a broken Pages build either.
8. **The suite is not reproducible.** `requirements-dev.txt` uses `>=` for
   pytest, playwright, fastapi and uvicorn, and CI installs it unpinned. A
   Playwright major changes `route.fulfill` and `inner_text` semantics, so the
   same commit can stop passing. Add `constraints.txt` with `==` and pass `-c`.
9. **Accessibility.** `#chatTranscript` is `role="log" aria-live="polite"` while
   `typeOut` rewrites `innerHTML` every animation frame, so a screen reader
   queues an announcement per chunk of a long answer. Set `aria-busy` during the
   reveal. The page also has no `<h1>` and no Open Graph tags (`grep -c 'og:' index.html`
   -> 0), which costs the link preview when the page is pasted into email or chat.
10. **Test gaps, and one wrong comment.** No test covers the menus,
    preferences, the warn meter, save/copy, or drag and resize. And
    `tests/conftest.py` says `page.wait_for_function` "is not usable here"
    because CSP blocks in-page eval. It does not: `wait_for_function("() => true")`
    runs against the CSP-serving fixture, which is also why `page.evaluate` works
    in `test_pasted_html_is_not_trusted`. The two polling helpers work around a
    bar that is not there, and their 45 s worst case is why the failure-path
    test is slow.

## P2

11. The security policy is copy-pasted into the meta tag in `index.html`,
    `app.py` and `tests/conftest.py`, and two of the three comments say that
    drift is the risk. Generate all three from one file and assert they match.
12. `routeKey` matches `/right(s)?\b/` and `/school/` anywhere, so "my child
    isn't sleeping right" returns the CRPD answer, and `/emergency/` fires a
    crisis block for "emergency contact for the audiologist". Tighten to phrases.
13. `app.py:46` annotates `-> FileResponse` on a handler declared
    `response_class=HTMLResponse`, and only `/` gets `no-cache`; `/index.html`
    is served with the hour cache.
14. `execCommand` is deprecated and behaves differently in Firefox and Safari.
    It works today; the replacement is a `beforeinput`/Range writer.
15. Translations are keyed by exact English source text, which is what makes
    switching back to English lossless, but a copy edit silently drops a
    translation with no error. Add a test that collects every translatable
    string from `app.js` and `index.html` and fails when one is missing from the
    table.

## Reproduce

    git clone https://github.com/claytonvlawson/learnwithclayparentadvisor.git
    cd learnwithclayparentadvisor
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements-dev.txt
    python -m playwright install chromium
    python -m pytest -q

    # the deploy exposes sources (while the mirror is up):
    curl -s -o /dev/null -w '%{http_code}\n' \
      https://claytonvlawson.github.io/learnwithclayparentadvisor/app.py

    # payload weight:
    python3 -c "import gzip;print(len(gzip.compress(open('i18n.js','rb').read(),9)))"
