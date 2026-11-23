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

## P1

Items 4 through 10 are closed; the work and its evidence are in the commits that
closed them, and the acceptance criteria are in the issue tracker.

4. **Resolved.** **`i18n.js` shipped 359 KB raw / 85 KB gzipped to every visitor**, and was
   parsed before `app.js`. That is 39 percent of the page's gzipped weight
   (578 KB raw, 217 KB gz measured with `gzip -9`) for a reader who needs none
   of it. The table is now `i18n/<code>.js`, fetched on selection; English loads
   nothing. English first paint is 36 KB gzipped against 115 KB, and
   `tests/test_i18n_payload.py` holds the behaviour.
5. **Resolved.** **Images.** `aol-figure.png` was 328x360 and 82 KB to paint a
   30x33 logo; it is 60x66 and 1.5 KB now, 54x smaller, RMSE 4/255 against the
   original downscale. `aim-logo.png` (20 KB) had zero references and is gone.
   `tests/test_assets.py` keeps both from coming back.
6. **Resolved.** **The deploy published the repository, not the site.** Pages
   served the root as-is, so `app.py` and `tests/test_chat.py` fetched as 200.
   The deploy now stages only the page: `tools/stage_site.sh` copies 24 files and
   the `pages` workflow uploads that directory, with Pages switched from the
   branch source to the Actions source. The public URL no longer serves app.py,
   the tests, the README, or security.json. `app.py` still serves the repo root,
   which is local only.
7. **Resolved by retiring Netlify.** The live URL
   `https://learnwithclayparentadvisor.netlify.app/` returns 503
   `{"error":"usage_exceeded"}`. GitHub Pages is now the only deploys target, so
   the dead link is gone; an uptime check is still worth adding, because nothing
   in the repo would report a broken Pages build either.
8. **Resolved.** **The suite was not reproducible.** `constraints.txt` pins all
   four dependencies exactly, CI installs with `-c constraints.txt`, and
   `tests/test_config.py` fails if a dependency loses its pin or CI drops the flag.
9. **Resolved.** **Accessibility.** The transcript is `aria-busy` from the
   question until the reveal settles, so the live region stops announcing every
   frame. There is one visually hidden `<h1>` and a share card with absolute
   `og:` URLs and a real image. `tests/test_ui.py` asserts all of it.
10. **Resolved.** **Test gaps, and one wrong comment.** `tests/test_ui.py`
    covers menus, preferences across a reload, the warn meter running out, saving
    the transcript, the busy state, the heading and the share card.
    `tests/test_routing.py` covers ten routing cases. The false CSP claim is gone:
    the helpers are `wait_for_function` calls now, and 70 tests run in about 20 s.

## P2

11. **Resolved.** `security.json` is the only place the policy is written;
    `policy.py` reads it, `app.py` and the test server consume it, and the meta
    tag is asserted equal to the derived meta form (`tests/test_config.py`).
12. **Resolved.** The topic routes are phrases now, so "sleeping right" and
    "emergency contact" no longer hijack an answer, and the plainest disclosure
    ("I don't want to live") was added after it missed. `tests/test_routing.py`.
15. **Resolved.** `tests/test_i18n_coverage.py` fails in both directions now.
    Its first run found a real defect: all 17 tables carried a translation of
    "A knowledge base your AI Agents control, where quality data provides better
    results", copy from another product that is not on this page. Removed from
    every table.

Still open:

13. `app.py` annotates `-> FileResponse` on a handler declared
    `response_class=HTMLResponse`, and only `/` gets `no-cache`; `/index.html` is
    served with whatever the host decides.
14. `execCommand` is deprecated and behaves differently in Firefox and Safari.
    It works today; the replacement is a `beforeinput`/Range writer.

## Reproduce

    git clone https://github.com/claytonvlawson/learnwithclayparentadvisor.git
    cd learnwithclayparentadvisor
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements-dev.txt -c constraints.txt
    python -m playwright install chromium
    python -m pytest -q

    # the deploy ships the page, not the repository: both of these are 404
    for f in app.py tests/test_chat.py; do
      curl -s -o /dev/null -w "%{http_code}\n" \
        "https://claytonvlawson.github.io/learnwithclayparentadvisor/$f"
    done

    # payload weight:
    python3 -c "import gzip;print(len(gzip.compress(open('i18n.js','rb').read(),9)))"
