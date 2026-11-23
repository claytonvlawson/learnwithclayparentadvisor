# Parent Advisor: Vault Preview

[![tests](https://github.com/claytonvlawson/learnwithclayparentadvisor/actions/workflows/tests.yml/badge.svg)](https://github.com/claytonvlawson/learnwithclayparentadvisor/actions/workflows/tests.yml)

A working front end for the LearnWithClay Parent Advisor: a retrieval-augmented
advisor for hearing parents of Deaf and hard of hearing children. Answers are
grounded in a curated knowledge base and cite the notes they came from; a crisis
question gets resources first, before any research language.

It is deliberately period-correct: an AOL Instant Messenger / Windows 95 desktop,
because the parents this is built for remember that interface as the place where
they first talked to strangers about hard things.

![The sign-on screen](docs/sign-on.png)

![The advisor window after one question](docs/im-window.png)

- Live: https://claytonvlawson.github.io/learnwithclayparentadvisor/
- Backend it calls: https://learnwithclay.ai/api/parent/chat
- No build step, no framework, no dependencies in the shipped page

## What it does

- **An IM window as the chat surface.** Buddy list, taskbar, windows you can drag
  and resize, sounds, a 1990s menubar. The chrome is the point: it lowers the
  stakes of asking a frightening question.
- **Answers arrive from a real RAG backend**, streamed into the transcript with a
  typewriter reveal, and the citation list links the notes behind the answer.
- **18 languages**, including right-to-left Arabic and Urdu. The picker
  retranslates the whole document in place: every translatable string is keyed by
  its English source text, so switching back to English is lossless. Each table
  is its own file, fetched when it is picked, so an English visit downloads none
  of them.
- **A crisis path that cannot be lost in the ranking.** If the parent's own words
  match the safety patterns, the 988 line and the guardrails note lead the answer.
- **Keyboard and screen-reader behaviour**: the shell is made inert while a modal
  is open, Tab is trapped inside it, and every window is reachable from the
  taskbar.

## How the code is laid out

There is no build step: the browser loads four files in order, and a fifth only
when a visitor picks a language other than English.

| File | What lives there |
|---|---|
| `index.html` | markup only: the sign-on dialog, buddy list, IM window, taskbar, modal shell |
| `assets/styles.css` | the whole stylesheet, including the 18-language font stacks and RTL rules |
| `assets/app.js` | all behaviour: prefs, language wiring, windows, menus, composer, chat, citations, sanitizer |
| `i18n.js` | the translation runtime: language list, English templates, and the loader |
| `security.json` / `policy.py` | the security headers, in one place, read by `app.py` and the test server and mirrored by the meta tag |
| `i18n/<code>.js` | one translation table per language, keyed by English text, fetched when that language is selected |

`assets/app.js` opens with a structural map of its own regions, in order: config
and prefs, language, chrome, accessibility, menus, windows, sign-on, help,
composer, chat, transcript tools.

Screen to code:

| On screen | Markup | Behaviour |
|---|---|---|
| Sign-on dialog | `#signon` in `index.html` | `signOn`, `setScreenName`, `buildLangSelect` in `assets/app.js` |
| Buddy list | `#buddylist` | `openIM`, `refreshInert` |
| IM window and transcript | `#imwin`, `#chatTranscript` | `ask`, `reveal`, `typeOut`, `addMessage` |
| Citation list under an answer | inserted at runtime | `renderCitations`, `safeHref` |
| Composer and its toolbar | `#chatInput`, `#sendBtn` | `sendFromComposer`, `sanitizeRich`, `emotify` |
| Taskbar and windows | `#taskbar` | `setWin`, `focusWin`, `makeDraggable`, `makeResizable` |

## The API contract

One endpoint. The page posts a question and expects an answer plus citations.

    POST https://learnwithclay.ai/api/parent/chat
    Content-Type: application/json

    {"question": "...", "sessionId": "...", "language": "es"}

`question` is the plain text of the composer, truncated to 460 characters. When
the page is not in English, a short English tail is appended
(`(Answer in Spanish.)`) so retrieval keeps its English tokens while the model is
told which language to answer in. `sessionId` is a random id per browser session,
used by the backend for rate limiting rather than identity.

    200 OK
    {
      "answer": "The first 90 days are mostly audiology ...",
      "sources": ["Notes/First 90 Days After Diagnosis.md"],
      "citations": [
        {"title": "Language and brain development in deaf children",
         "url": "https://doi.org/10.1093/deafed/enz012",
         "citation": "Hall, M. (2019) ..."}
      ]
    }

- `answer` is required; without it the page shows its error line plus the
  routing hints for the question.
- `citations` is preferred; each entry needs `title` and either `url` or `doi`.
  Links are re-checked with `safeHref` before they reach the DOM, so a
  `javascript:` or `data:` URL from the API cannot become a live link.
- `sources` alone is enough: the page falls back to "answered from N vault notes".
- Any non-2xx, a network failure, or 25 seconds of silence falls back to a
  built-in preview answer, so the page never hangs on a dead backend.

The backend itself is a separate service; this repository only consumes it.

## Running it

Static, so anything that serves files works:

    python3 -m http.server 8080        # then open http://localhost:8080

Or run the Python host, which sends the same security headers as the deploy:

    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements-dev.txt
    python3 app.py                     # http://127.0.0.1:8020, /healthz for liveness

## Tests

68 tests. 49 run in the browser with no network and no live backend: the advisor
endpoint is stubbed with Playwright routing, and the suite runs under the page's
Content-Security-Policy, because a CSP violation is exactly the kind of breakage a
headless run should catch. The other 19 are static checks that need no browser:
image weight and orphans, pinned dependencies, one policy in three places, and
the translation tables against the page's copy.

    pip install -r requirements-dev.txt -c constraints.txt
    python -m playwright install chromium
    python -m pytest

| File | What it pins down |
|---|---|
| `tests/test_shell.py` | the page loads with no console errors, assets are separate files (not re-inlined), the language picker is populated from `i18n.js`, sign-on opens the IM window, screen names are scrubbed |
| `tests/test_chat.py` | the question that goes on the wire (with `language` and `sessionId`), the answer and citations reaching the transcript, the fallback when the API fails, and that pasted or dropped HTML cannot inject markup |
| `tests/test_i18n.py` | switching language retranslates the document, the choice survives sign-on, switching back to English is lossless, Arabic sets `dir="rtl"` |
| `tests/test_review_fixes.py` | the three defects found in the November 2026 review: citation text staying inside its attribute, a second Enter not starting a second request, and the offline crisis route firing in Spanish and Chinese |
| `tests/test_i18n_payload.py` | one translation file per language: English fetches none, selecting a language fetches that one, a loaded language is not fetched twice, and every advertised language has a file |
| `tests/test_ui.py` | the chrome the suite used to skip: a menubar opens and Escape closes it, preferences survive a reload, the warn meter runs out and disables, saving downloads the transcript, the transcript is `aria-busy` during a reveal, one `h1`, and a share card with absolute URLs |
| `tests/test_routing.py` | where a question routes when the backend is down: ten cases, including the two that used to misfire and the plainest English disclosure |
| `tests/test_assets.py` | no unreferenced image, no root PNG over 20 KB, the logo is no more than 2x its display size |
| `tests/test_config.py` | the policy in `security.json` matches all three consumers, every dependency is pinned in `constraints.txt`, CI applies the pins, and no home path is committed |
| `tests/test_i18n_coverage.py` | every language has the same keys, every canned block exists everywhere, no key translates copy that is gone, and the templates carry the English placeholders |

`docs/REVIEW.md` is that review: what holds up, what was fixed, and what is
still open, each item with the command that shows it.

Each language table is its own file, 15 to 30 KB, and is fetched the first time
that language is picked. English is the source text and has no file, so an
English visit downloads the runtime only. `tools/split_i18n.py` is the one-shot
migration that moved the tables out of `i18n.js`.

`tools/shots.py` regenerates the two screenshots above from the real page.
`tools/split_site.py` is the one-shot migration that moved the CSS and JS out of
`index.html`; it refuses to run on an already-split page.

## Status: what is not done

Working and in use: the chat surface, the 18-language picker, citations, the
crisis-first routing, keyboard and screen-reader behaviour, and the deploy.

Not done, in the order I would fix it:

1. **No streaming from the backend.** The answer arrives whole and the typewriter
   reveal is client-side theatre. Real token streaming needs an SSE endpoint and
   a different render path.
2. **`assets/app.js` is still one behaviour file** (about 1,900 lines) rather than
   the five-way split (state, i18n wiring, composer, sanitizer, render) the CSS
   and markup split implies. The browser tests exist now, which is what makes that
   next split safe; it is not done yet.
3. **Vocabulary is still written in three places** (the English strings in
   `assets/app.js`, the per-language tables, and the markup), but it no longer
   fails silently: `tests/test_i18n_coverage.py` fails when a string is added to
   the page and not to the table, and when a table translates copy that has been
   edited away.
4. **No visual regression baseline.** Layout assertions are structural, so a CSS
   change that breaks alignment but not the DOM would pass.
5. **The backend is not in this repo**, so the contract above is documented from
   the client side only.

## Contributing

Read the [Code of Conduct](CODE_OF_CONDUCT.md) before opening an issue or a pull
request. It is a Contributor Covenant 2.1 document with project-specific rules on
grounding answers in cited sources, Deaf-centered framing, keeping crisis handling
intact, and accessibility in how we work.

## Deploy

GitHub Pages, published from `main` by `.github/workflows/pages.yml`. The page
has no build step, but the deploy stages only the files the site serves, because
a static host cannot be told to ignore a source file: `tools/stage_site.sh`
copies `index.html`, `assets/`, `i18n/`, the two images and the social card into
`_site/`, and that directory is what gets uploaded. Pages is set to the Actions
source rather than the branch, so `app.py`, `tests/` and the README are not
reachable from the public URL.

    https://claytonvlawson.github.io/learnwithclayparentadvisor/

Pages cannot send response headers, so the Content-Security-Policy ships as a
meta tag in `index.html`; `app.py` and `tests/conftest.py` send the same policy as
a header, and the smoke suite runs under it. The one thing the header had that
the meta tag cannot carry is `frame-ancestors`, so clickjacking protection is the
known gap. Pages also caches for about ten minutes on its own; there is no
per-file cache configuration to set.

The deploy is probed from the outside every six hours by `.github/workflows/uptime.yml`,
which runs `tools/check_live.sh`: every file a first visit asks for must answer
200, the repository files must answer 404, and the runtime must still be small
enough that the language tables have not moved back into it. A failure opens (or
comments on) an issue rather than only reddening a tab. Run it by hand:

    sh tools/check_live.sh
    BASE_URL=http://127.0.0.1:8020 sh tools/check_live.sh

## License

The code is MIT. The knowledge base it answers from is not in this repository and
is not covered by that license.

The page calls the live advisor at `https://learnwithclay.ai/api/parent/chat`;
that endpoint allows the Pages origin `https://claytonvlawson.github.io` in
`api/parent/chat.js` of `learnwithclay-site`. Without that entry the page still
renders and answers with the canned preview routing, but no live answers arrive.

Demo limits come from the API, not the page: there is no daily question cap,
just a 30-per-minute per-IP burst guard in `api/parent/chat.js` of
`learnwithclay-site`. Set `PARENT_DAILY_LIMIT` in the Vercel project to put a
daily cap back.
