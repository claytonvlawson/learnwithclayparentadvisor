"""The translation table is per language and fetched on demand.

Before this, all 17 tables shipped inside `i18n.js` (359 KB raw, 85 KB gzipped),
so an English visitor downloaded every translation to read none of them. These
tests pin the behaviour that replaced it: English fetches nothing, picking a
language fetches that one file, and a language already loaded is not fetched
twice.
"""
import os

from conftest import ROOT, wait_for_text_change

I18N_RUNTIME = os.path.join(ROOT, "i18n.js")
LANG_DIR = os.path.join(ROOT, "i18n")


def watch_chunks(page):
    """Collect the URLs of language-table requests from now on."""
    chunks = []
    page.on("request", lambda r: chunks.append(r.url) if "/i18n/" in r.url else None)
    return chunks


def test_english_visit_fetches_no_language_table(app_page):
    chunks = watch_chunks(app_page)
    app_page.reload(wait_until="load")
    # <option> elements are never "visible"; wait for the list to be populated
    app_page.wait_for_function(
        "() => document.querySelectorAll('#langPickSignon option').length > 1")
    assert chunks == [], chunks
    assert app_page.evaluate("window.PAi18n.lang()") == "en"


def test_selecting_a_language_fetches_only_that_table(app_page):
    chunks = watch_chunks(app_page)
    original = app_page.inner_text("#signonTitle")
    app_page.select_option("#langPickSignon", "es")
    wait_for_text_change(app_page, "#signonTitle", original)
    assert len(chunks) == 1, chunks
    assert chunks[0].endswith("/i18n/es.js"), chunks
    assert app_page.inner_text("#signonTitle") == "Conectarse"


def test_a_language_already_loaded_is_not_fetched_again(app_page):
    chunks = watch_chunks(app_page)
    original = app_page.inner_text("#signonTitle")

    app_page.select_option("#langPickSignon", "es")
    wait_for_text_change(app_page, "#signonTitle", original)
    spanish = app_page.inner_text("#signonTitle")

    app_page.select_option("#langPickSignon", "ko")
    wait_for_text_change(app_page, "#signonTitle", spanish)
    korean = app_page.inner_text("#signonTitle")

    app_page.select_option("#langPickSignon", "es")
    wait_for_text_change(app_page, "#signonTitle", korean)
    assert app_page.inner_text("#signonTitle") == spanish

    # two languages selected, two files fetched, none of them twice
    names = sorted(url.rsplit("/", 1)[-1] for url in chunks)
    assert names == ["es.js", "ko.js"], names


def test_the_runtime_ships_no_language_data(app_page):
    size = os.path.getsize(I18N_RUNTIME)
    assert size < 40 * 1024, "i18n.js is %d bytes; the tables belong in i18n/" % size


def test_every_advertised_language_has_a_table(app_page):
    codes = app_page.evaluate("window.PAi18n.LANGS.map(l => l.code)")
    assert "en" in codes
    missing = [c for c in codes if c != "en" and not os.path.exists(os.path.join(LANG_DIR, c + ".js"))]
    assert missing == [], missing
    assert not os.path.exists(os.path.join(LANG_DIR, "en.js")), "English is the source text, not a table"


def test_a_language_file_switches_the_document(app_page):
    # Loading the table is only half of it: the document has to be retranslated
    # from it, including the right-to-left direction.
    original = app_page.inner_text("#signonTitle")
    app_page.select_option("#langPickSignon", "ar")
    wait_for_text_change(app_page, "#signonTitle", original)
    assert app_page.evaluate("document.documentElement.dir") == "rtl"
    assert app_page.inner_text("#signonTitle") != original