"""Chat: composer, the request that goes out, and how the answer is rendered.

The advisor API is stubbed, so these assert the front end's contract: what it
sends, and that an answer plus its citations reach the transcript instead of
being swallowed by a render error.
"""
from conftest import sign_on, wait_for_text


def ask(app_page, text):
    sign_on(app_page)
    app_page.fill("#chatInput", text)
    app_page.click("#sendBtn")


def test_composer_sends_the_question_and_the_language(app_page, stub_advisor):
    ask(app_page, "my son just failed his hearing test, what now")
    app_page.wait_for_selector(".mline[data-who='advisor']", timeout=30000)
    assert stub_advisor, "no request reached the API"
    body = stub_advisor[0]
    assert "hearing test" in body["question"]
    assert body["language"] == "en"
    assert body["sessionId"]


def test_answer_text_reaches_the_transcript(app_page, stub_advisor):
    ask(app_page, "what are the first steps")
    app_page.wait_for_selector(".mline[data-who='advisor']", timeout=30000)
    wait_for_text(app_page, "first 90 days")


def test_citations_render_as_links(app_page, stub_advisor):
    ask(app_page, "what are the first steps")
    app_page.wait_for_selector("a.doi-link", timeout=30000)
    href = app_page.get_attribute("a.doi-link", "href")
    assert href == "https://doi.org/10.1093/deafed/enz012"
    assert app_page.get_attribute("a.doi-link", "rel") == "noopener noreferrer"
    assert app_page.get_attribute("a.doi-link", "target") == "_blank"


def test_non_english_question_carries_an_english_hint(app_page, stub_advisor):
    sign_on(app_page)
    # The sign-on picker is behind the overlay after sign-in; the buddy-list
    # picker drives the same i18n runtime.
    app_page.select_option("#langPickBuddy", "es")
    app_page.fill("#chatInput", "cuales son los primeros pasos")
    app_page.click("#sendBtn")
    app_page.wait_for_selector(".mline[data-who='advisor']", timeout=30000)
    body = stub_advisor[0]
    assert "Answer in" in body["question"]
    assert body["language"] == "es"


def test_failed_request_falls_back_instead_of_hanging(app_page, stub_advisor):
    # Replace the stub with a hard failure: the preview answer must appear.
    app_page.unroute("**/api/parent/chat")
    app_page.route("**/api/parent/chat", lambda route: route.abort())
    ask(app_page, "what are the first steps")
    # The answer arrives by typewriter, so poll for the fallback wording
    # rather than reading the transcript once.
    import time
    deadline = time.time() + 45
    body = ""
    while time.time() < deadline:
        body = app_page.inner_text("#chatTranscript").lower()
        if "preview" in body or "could not be reached" in body:
            return
        app_page.wait_for_timeout(400)
    raise AssertionError("no fallback answer appeared: %s" % body[:400])


def test_sanitizer_strips_a_dangerous_link_from_the_api(app_page):
    app_page.unroute("**/api/parent/chat")
    app_page.route("**/api/parent/chat", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='{"answer":"See the note.","citations":['
             '{"title":"bad","url":"javascript:alert(1)"}]}'))
    ask(app_page, "show me the note")
    app_page.wait_for_selector(".mline[data-who='advisor']", timeout=30000)
    hrefs = app_page.eval_on_selector_all("a", "els => els.map(e => e.getAttribute('href'))")
    assert not any(h and h.lower().startswith("javascript:") for h in hrefs)


def test_pasted_html_is_not_trusted(app_page):
    sign_on(app_page)
    # Drive the real paste path: a ClipboardEvent carrying both text/html and
    # text/plain. The composer forces plain text, so no markup reaches the
    # transcript and nothing in the payload runs.
    app_page.evaluate("""() => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<b>hello</b><img src=x onerror="window.__pwned=1">');
        dt.setData('text/plain', 'hello');
        const ev = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
        document.getElementById('chatInput').dispatchEvent(ev);
    }""")
    pasted = app_page.eval_on_selector("#chatInput", "el => el.innerHTML")
    assert "<img" not in pasted.lower()
    assert "<b>" not in pasted.lower()
    app_page.click("#sendBtn")
    app_page.wait_for_timeout(1500)
    assert app_page.evaluate("window.__pwned === undefined")
    transcript = app_page.inner_html("#chatTranscript")
    assert "<img" not in transcript.lower()


def test_dropped_html_is_not_trusted(app_page):
    # Same guard for drag-and-drop, which used to insert markup directly.
    sign_on(app_page)
    app_page.evaluate("""() => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<img src=x onerror="window.__dropped=1">dropped');
        dt.setData('text/plain', 'dropped');
        const ev = new DragEvent('drop', {dataTransfer: dt, bubbles: true, cancelable: true});
        document.getElementById('chatInput').dispatchEvent(ev);
    }""")
    app_page.wait_for_timeout(800)
    dropped = app_page.eval_on_selector("#chatInput", "el => el.innerHTML")
    assert "<img" not in dropped.lower()
    assert app_page.evaluate("window.__dropped === undefined")

