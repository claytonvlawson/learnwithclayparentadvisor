"""The parts of the desktop the suite never touched.

Menus, preferences, the warn meter, saving a conversation, and the live region
during a reveal. All of it is chrome, and chrome is what breaks when a selector
moves: these assert behaviour a visitor would notice, not structure.
"""
import json

from conftest import sign_on, wait_for_text, wait_for_text_change


def open_menu(page, window, label):
    page.click('.menubar[data-menu="%s"] > button:has-text("%s")' % (window, label))
    page.wait_for_selector('.menubar[data-menu="%s"] .menu.open' % window, timeout=5000)


def test_a_menubar_opens_and_escape_closes_it(app_page):
    sign_on(app_page)
    open_menu(app_page, "buddylist", "My AIM")
    assert app_page.eval_on_selector_all(".menu.open", "n => n.length") == 1
    app_page.keyboard.press("Escape")
    assert app_page.eval_on_selector_all(".menu.open", "n => n.length") == 0


def test_preferences_survive_a_reload(app_page):
    sign_on(app_page)
    app_page.click("#setupBtn")
    app_page.wait_for_selector("#modal.open #prefBig", timeout=5000)
    app_page.check("#prefBig")
    app_page.check("#prefClock")
    app_page.click("#modal .foot .btn3d:last-child")   # Apply
    assert "large" in app_page.eval_on_selector("body", "b => b.className")

    app_page.reload(wait_until="load")
    sign_on(app_page)
    assert "large" in app_page.eval_on_selector("body", "b => b.className")
    clock = app_page.inner_text("#clock")
    assert "M" not in clock, "24 hour clock did not survive the reload: %r" % clock
    assert ":" in clock


def test_the_warn_meter_runs_out_and_disables_the_button(app_page):
    sign_on(app_page)
    for _ in range(5):
        app_page.click("#warnBtn")
        app_page.wait_for_selector("#modal.open", timeout=5000)
        app_page.click('#modal .foot .btn3d:has-text("Send Warning")')
        app_page.wait_for_selector("#modal", state="hidden", timeout=5000)
    assert app_page.inner_text("#warnPct") == "100%"
    assert app_page.eval_on_selector("#warnBtn", "b => b.disabled") is True
    assert app_page.eval_on_selector(".warnmeter", "e => e.getAttribute('aria-valuenow')") == "100"


def test_saving_the_conversation_downloads_the_transcript(app_page, stub_advisor):
    sign_on(app_page)
    app_page.fill("#chatInput", "what are the first steps")
    app_page.click("#sendBtn")
    wait_for_text(app_page, "first 90 days", timeout=30)

    open_menu(app_page, "im", "File")
    with app_page.expect_download(timeout=10000) as dl:
        app_page.click('.menubar[data-menu="im"] .menu.open button[data-act="save"]')
    download = dl.value
    assert download.suggested_filename.endswith(".txt")
    path = download.path()
    text = open(path, encoding="utf-8").read()
    assert "first 90 days" in text
    assert "TestParent" in text, "the visitor's own line should be in the saved transcript"


def test_the_transcript_is_busy_while_an_answer_reveals(app_page):
    held = []

    def hold(route):
        held.append(route)

    app_page.unroute("**/api/parent/chat")
    app_page.route("**/api/parent/chat", hold)
    sign_on(app_page)
    app_page.fill("#chatInput", "what are the first steps")
    app_page.press("#chatInput", "Enter")
    app_page.wait_for_selector(".mline.is-typing", timeout=5000)
    assert app_page.eval_on_selector("#chatTranscript", "e => e.getAttribute('aria-busy')") == "true"

    # a long answer so the reveal has some frames to run through
    long_answer = ("The first ninety days are mostly audiology and language access. " * 8).strip()
    held[0].fulfill(status=200, content_type="application/json",
                    body=json.dumps({"answer": long_answer, "sources": ["Notes/First 90 Days.md"]}))
    wait_for_text(app_page, "first ninety days", timeout=30)
    # once the reveal settles the live region goes quiet again
    app_page.wait_for_function(
        "() => document.querySelector('#chatTranscript').getAttribute('aria-busy') === 'false'",
        timeout=15000)
    assert app_page.eval_on_selector("#chatTranscript", "e => e.getAttribute('aria-busy')") == "false"


def test_the_page_has_one_heading(app_page):
    headings = app_page.eval_on_selector_all("h1", "els => els.map(e => e.textContent.trim())")
    assert len(headings) == 1, headings
    assert "Parent Advisor" in headings[0]


def test_the_share_card_is_absolute(app_page):
    meta = app_page.evaluate("""() => {
      const g = (p) => { const m = document.querySelector(`meta[property="${p}"]`); return m && m.content; };
      return {title: g('og:title'), desc: g('og:description'), url: g('og:url'),
              image: g('og:image'), type: g('og:type')};
    }""")
    for name in ("title", "desc", "url", "image", "type"):
        assert meta[name], "missing og:%s" % name
    assert meta["url"].startswith("https://")
    assert meta["image"].startswith("https://")