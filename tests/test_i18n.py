"""Language switching: the i18n runtime has to retranslate the whole document.

The string table lives in i18n.js and keys off the English text, so this is the
test that catches a translation wiring regression (a selector renamed in the
split, a picker rebuilt without its change handler).
"""
from conftest import sign_on, wait_for_text_change


def test_switching_language_retranslates_the_sign_on(app_page):
    original = app_page.inner_text("#signonTitle")
    app_page.select_option("#langPickSignon", "es")
    wait_for_text_change(app_page, "#signonTitle", original)
    assert app_page.inner_text("#signonTitle") != original


def test_language_survives_signing_on(app_page):
    app_page.select_option("#langPickSignon", "ko")
    sign_on(app_page)
    lang = app_page.evaluate("document.documentElement.lang")
    assert lang == "ko"


def test_switching_back_to_english_restores_the_original_strings(app_page):
    original = app_page.inner_text("#signonTitle")
    app_page.select_option("#langPickSignon", "ja")
    app_page.wait_for_timeout(500)
    app_page.select_option("#langPickSignon", "en")
    app_page.wait_for_timeout(500)
    assert app_page.inner_text("#signonTitle") == original


def test_rtl_language_sets_the_text_direction(app_page):
    app_page.select_option("#langPickSignon", "ar")
    app_page.wait_for_timeout(800)
    assert app_page.evaluate("document.documentElement.dir") == "rtl"
