"""The sign-on flow and the desktop shell.

These are the tests that catch a split-file refactor going wrong: if app.js
fails to load, no window ever opens and every test here fails at once.
"""
from conftest import sign_on


def test_page_loads_without_console_errors(app_page):
    assert app_page.title() == "Parent Advisor: AIM Edition"
    app_page.wait_for_selector("#signon", state="visible")
    assert app_page.console_errors == [], app_page.console_errors


def test_markup_does_not_carry_its_own_css_or_js(app_page):
    # The whole point of the split: the page references assets instead of
    # embedding them. A regression that inlines them again fails here.
    hrefs = app_page.evaluate(
        "Array.from(document.querySelectorAll('link')).map(l => l.getAttribute('href'))")
    assert "assets/styles.css" in hrefs

    sources = app_page.evaluate(
        "Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src'))")
    assert "assets/app.js" in sources
    assert "i18n.js" in sources

    # No inline <style> block and no inline <script> with a body.
    assert app_page.evaluate("document.querySelectorAll('style').length") == 0
    assert app_page.evaluate(
        "Array.from(document.querySelectorAll('script')).filter(s => !s.src && s.textContent.trim()).length"
    ) == 0

    css = app_page.evaluate(
        "Array.from(document.styleSheets).map(s => s.href || 'inline')")
    assert any(h and h.endswith("assets/styles.css") for h in css), css


def test_language_picker_is_populated_from_i18n(app_page):
    options = app_page.eval_on_selector_all("#langPickSignon option", "els => els.map(e => e.value)")
    assert "en" in options
    assert len(options) >= 10, "expected the i18n language list, got %r" % options


def test_sign_on_opens_the_im_window(app_page):
    sign_on(app_page)
    assert app_page.is_visible("#imwin")
    assert app_page.is_visible("#buddylist")


def test_blank_screen_name_falls_back_to_the_default(app_page):
    # Documented behaviour, not an error: an empty box signs on as
    # "VisitingParent" instead of trapping the visitor in the dialog.
    app_page.fill("#snInput", "   ")
    app_page.click("#signOnBtn")
    app_page.wait_for_selector("#imwin", state="visible", timeout=10000)
    assert app_page.inner_text("#snLabel") == "VisitingParent"


def test_screen_name_is_scrubbed_of_punctuation(app_page):
    app_page.fill("#snInput", "Ada<script>")
    app_page.click("#signOnBtn")
    app_page.wait_for_selector("#imwin", state="visible", timeout=10000)
    label = app_page.inner_text("#snLabel")
    assert "<" not in label and ">" not in label
    assert label.strip()


def test_menubar_is_built_by_script(app_page):
    assert app_page.evaluate("document.querySelectorAll('.menubar > button').length") >= 3


def test_taskbar_buttons_open_windows(app_page):
    sign_on(app_page)
    app_page.click('.task-item[data-win="howtowin"]')
    assert app_page.is_visible("#howtowin")
