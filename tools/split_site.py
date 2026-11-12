#!/usr/bin/env python3
"""Split the single-file page into markup + styles + behaviour.

Before: index.html carried 483 lines of CSS and 1905 lines of JavaScript, so a
reader had to scroll past both to find the sign-on markup.

After:
  index.html          markup only, links the two asset files
  assets/styles.css   the stylesheet, unchanged
  assets/app.js       the behaviour, unchanged

Nothing is rewritten in this step. The point is that the next change to the
chat rendering touches a .js file and not a 118 KB HTML document.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

html = INDEX.read_text(encoding="utf-8")

style_match = re.search(r"<style>\n(.*?)\n</style>\n", html, re.S)
script_match = re.search(r"<script>\n(.*?)\n</script>\n", html, re.S)
if not style_match or not script_match:
    raise SystemExit("could not find the style or script block")

css = style_match.group(1)
js = script_match.group(1)

(ASSETS / "styles.css").write_text(css + "\n", encoding="utf-8")

HEADER = """/* ============================================================================
   Parent Advisor, AIM Edition: page behaviour.

   Plain script, no build step and no framework: the page is a Windows-95-era
   desktop imitation, and the DOM is the state. Structure, in order:

     config and prefs      SITE, API, DEFAULTS, savePrefs
     language              detectLang, buildLangSelect, setLang (wires i18n.js)
     chrome                clock, toast, sounds
     accessibility         inert shell while a modal is open, focus trap
     menus                 the menubar and its items
     windows               open/close/focus/drag/resize, taskbar
     sign on               screen-name picker, rename, prefs
     help                  how-to-win steps, safety, keys, about
     composer              formatting, colours, smileys, caret handling
     chat                  send, stream, render, citations
   ========================================================================== */
"""

(ASSETS / "app.js").write_text(HEADER + js + "\n", encoding="utf-8")

new_html = (
    html[:style_match.start()]
    + '<link rel="stylesheet" href="assets/styles.css">\n'
    + html[style_match.end():script_match.start()]
    + '<script src="assets/app.js"></script>\n'
    + html[script_match.end():]
)

INDEX.write_text(new_html, encoding="utf-8")
print("styles.css", len(css.splitlines()), "lines")
print("app.js", len(js.splitlines()), "lines")
print("index.html", len(new_html.splitlines()), "lines")
print("script tags in index.html:", new_html.count("<script"))
