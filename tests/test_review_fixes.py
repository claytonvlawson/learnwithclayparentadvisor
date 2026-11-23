"""The three failure modes a review found, pinned down as tests.

Each of these reproduced against the code before the fix:

  * a citation string broke out of its `title` attribute and added a `style`
    (API-supplied text reaching an attribute position unescaped);
  * a second question sent from the composer while the first was in flight
    started a second request and re-enabled Send;
  * the offline crisis router matched English only, so a Spanish "quiero morir"
    fell through to the generic preview answer.
"""
import json

from conftest import API_GLOB, sign_on, wait_for_text

CRISIS_SENTINEL = "#chatTranscript [data-canned='crisisAnswer']"


def _answer(page, text):
    page.fill("#chatInput", text)
    page.press("#chatInput", "Enter")


def test_citation_text_cannot_add_attributes(app_page):
    # A quote in a citation must stay inside the attribute it was put in: no
    # extra attribute, and in particular no style, may appear on the <li>.
    payload = json.dumps({
        "answer": "Cited answer.",
        "citations": [{
            "title": "Innocuous note",
            "citation": 'He said "this is a test" style="position:fixed;inset:0" data-x="',
            "url": 'https://example.org/note" onmouseover="window.__hover=1',
        }],
    })
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda r: r.fulfill(
        status=200, content_type="application/json", body=payload))
    sign_on(app_page)
    _answer(app_page, "give me a cited answer")
    app_page.wait_for_selector(".cites li", timeout=30000)
    attrs = app_page.eval_on_selector_all(
        ".cites li", "els => els.map(e => Array.from(e.attributes).map(a => a.name))")
    assert attrs, "no citation row rendered"
    for names in attrs:
        assert names == ["title"], names

    # the citation text is still there, just inert
    title = app_page.get_attribute(".cites li", "title")
    assert "this is a test" in title
    assert "position:fixed" in title

    # and the href kept the quote inside the URL rather than opening an attribute
    link_attrs = app_page.eval_on_selector_all(
        ".cites a", "els => els.map(e => Array.from(e.attributes).map(a => a.name))")
    for names in link_attrs:
        assert "onmouseover" not in names, names


def test_second_question_is_ignored_while_one_is_in_flight(app_page):
    sent = []
    held = []

    # Hold the response open instead of sleeping inside the handler: a sleep
    # blocks Playwright's own loop, so the typing row would be gone by the time
    # the test could look at it.
    def hold(route):
        try:
            sent.append(json.loads(route.request.post_data or "{}"))
        except ValueError:
            sent.append({})
        held.append(route)

    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, hold)
    sign_on(app_page)

    _answer(app_page, "first question")
    app_page.wait_for_selector(".mline.is-typing", timeout=5000)
    # Enter is not the Send button: it used to slip past the disabled state
    _answer(app_page, "second question")
    assert app_page.eval_on_selector("#sendBtn", "b => b.disabled") is True
    app_page.wait_for_timeout(300)
    assert app_page.eval_on_selector_all(".mline.is-typing", "n => n.length") == 1
    assert len(sent) == 1, "a second request went out while the first was pending"

    held[0].fulfill(status=200, content_type="application/json",
                    body=json.dumps({"answer": "one slow answer", "sources": ["a.md"]}))
    wait_for_text(app_page, "one slow answer", timeout=30)
    app_page.wait_for_timeout(1200)
    assert len(sent) == 1
    answers = app_page.eval_on_selector_all(".mline[data-who='advisor']", "n => n.length")
    # two greeting lines plus exactly one answer
    assert answers == 3, answers


def test_spanish_crisis_question_reaches_the_crisis_route(app_page):
    # The API is down; this is the local fallback path.
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda route: route.abort())
    sign_on(app_page)
    app_page.select_option("#langPickBuddy", "es")
    _answer(app_page, "quiero morir, ya no aguanto")
    app_page.wait_for_selector(CRISIS_SENTINEL, timeout=30000)
    assert app_page.eval_on_selector_all("#chatTranscript a[href*='988lifeline']", "n => n.length") >= 2


def test_english_crisis_question_still_reaches_the_crisis_route(app_page):
    # The regression guard for the pattern sets: adding languages must not
    # dislodge the original path.
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda route: route.abort())
    sign_on(app_page)
    _answer(app_page, "my husband is hitting me and I want to die")
    app_page.wait_for_selector(CRISIS_SENTINEL, timeout=30000)


def test_chinese_crisis_question_reaches_the_crisis_route(app_page):
    # A non-Latin script must survive the route, not just the romanised ones.
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda route: route.abort())
    sign_on(app_page)
    app_page.select_option("#langPickBuddy", "zh")
    _answer(app_page, "我想死")
    app_page.wait_for_selector(CRISIS_SENTINEL, timeout=30000)
