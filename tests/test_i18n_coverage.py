"""The translation tables stay in step with the page.

Everything in the dictionary is keyed by exact English text, which is what makes
switching back to English lossless, and is also what makes a copy edit silently
drop a translation. Nothing used to notice, in either direction: a string added
to the page and not to the table just stayed English, and a translation of copy
that was edited away sat there forever.

The static side of that check is here. It joins the string concatenations the
page uses, decodes the HTML entities the markup uses, and accepts the few
strings the page composes at runtime, so a hit means a real mismatch.
"""
import html
import json
import os
import re

from conftest import ROOT

LANG_DIR = os.path.join(ROOT, "i18n")
APP = os.path.join(ROOT, "assets", "app.js")
HTML = os.path.join(ROOT, "index.html")
I18N = os.path.join(ROOT, "i18n.js")

# Built by concatenation at runtime, so they never appear in the source whole.
# If the wording of the toast changes, drop the old entry here rather than
# adding the new one: the point of this list is that it stays small.
COMPOSED_AT_RUNTIME = {
    "Sounds on",
    "Sounds off",
    "Citations shown",
    "Citations hidden",
}


def locales():
    out = {}
    for name in sorted(os.listdir(LANG_DIR)):
        if not name.endswith(".js"):
            continue
        code = name[:-3]
        text = open(os.path.join(LANG_DIR, name), encoding="utf-8").read()
        start = text.index("window.PAi18n.data(") + len("window.PAi18n.data(")
        data, _ = json.JSONDecoder().raw_decode(text[start:])
        out[code] = data[code]
    return out


def english_templates():
    source = open(I18N, encoding="utf-8").read()
    block = source[source.index("var EN_TEMPLATES = {"):]
    block = block[:block.index("};")]
    return dict(re.findall(r"(\w+):\s*'((?:[^'\\]|\\.)*)'", block))


def page_vocabulary():
    """The page's English text, with concatenations joined and entities decoded."""
    source = html.unescape(open(HTML, encoding="utf-8").read() + open(APP, encoding="utf-8").read())
    joined = re.sub(r"'\s*\+\s*'", "", source)      # 'one ' + 'two' -> 'one two'
    return html.unescape(joined)


def test_every_language_has_the_same_keys():
    data = locales()
    assert len(data) >= 17, sorted(data)
    keysets = {code: frozenset(d.get("ui", {})) for code, d in data.items()}
    first = next(iter(keysets.values()))
    for code, keys in keysets.items():
        assert keys == first, "%s: %d extra, %d missing" % (code, len(keys - first), len(first - keys))


def test_every_canned_block_exists_in_every_language():
    data = locales()
    used = {"crisisAnswer", "deprivationAnswer", "aslCiAnswer", "crpdAnswer", "fallbackAnswer"}
    for code, d in data.items():
        have = set(d.get("canned", {}))
        assert used <= have, "%s is missing %r" % (code, used - have)


def test_no_key_is_left_behind_by_the_page():
    vocabulary = page_vocabulary()
    templates = set(english_templates().values())
    stale = sorted(
        key for key in next(iter(locales().values()))["ui"]
        if key not in vocabulary and key not in templates and key not in COMPOSED_AT_RUNTIME
    )
    assert stale == [], "%d keys translate copy that is not on the page, e.g. %r" % (len(stale), stale[:5])


def test_every_string_the_script_asks_for_is_in_the_table():
    keys = set(next(iter(locales().values()))["ui"])
    app = open(APP, encoding="utf-8").read()
    asked = set(re.findall(r"i18n\.t\(\s*'((?:[^'\\]|\\.)*)'", app))
    missing = sorted(s for s in asked if s not in keys)
    assert missing == [], missing


def test_the_templates_carry_the_english_placeholders():
    # Same placeholders, not the same count: Arabic and other languages repeat
    # a placeholder when the grammar needs the number twice.
    english = english_templates()
    assert english, "could not read EN_TEMPLATES"

    def placeholders(text):
        return set(re.findall(r"\{(\w+)\}", text))

    for code, d in locales().items():
        got = d.get("templates", {})
        assert set(got) == set(english), "%s templates: %r" % (code, set(got) ^ set(english))
        for key, text in got.items():
            assert placeholders(text) == placeholders(english[key]), (
                "%s.%s placeholders %r, English %r"
                % (code, key, sorted(placeholders(text)), sorted(placeholders(english[key]))))


def test_english_is_not_a_table():
    assert not os.path.exists(os.path.join(LANG_DIR, "en.js"))