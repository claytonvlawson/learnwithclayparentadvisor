"""Image weight and orphans.

The page once shipped an 82 KB PNG to paint a 30x33 logo and a 20 KB asset that
nothing referenced. Both were invisible in review because a PNG has no diff to
read. These checks are cheap and catch the same thing coming back.
"""
import os
import re
import struct

from conftest import ROOT

# files a browser can be pointed at from the page
SOURCE_FILES = ["index.html", "assets/styles.css", "assets/app.js", "i18n.js"]
MAX_ROOT_PNG = 20 * 1024


def referenced_blob():
    return "\n".join(open(os.path.join(ROOT, name), encoding="utf-8").read() for name in SOURCE_FILES)


def png_size(path):
    """Width, height, straight out of the IHDR chunk."""
    with open(path, "rb") as fh:
        head = fh.read(26)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", path
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def root_pngs():
    return sorted(f for f in os.listdir(ROOT) if f.endswith(".png"))


def test_no_root_image_is_unreferenced():
    text = referenced_blob()
    orphans = [f for f in root_pngs() if f not in text]
    assert orphans == [], "nothing on the page references %r" % orphans


def test_root_images_stay_small():
    # The page's own images, not the docs/ screenshots (those are for the README
    # and the social card and are never fetched by a visitor).
    heavy = {f: os.path.getsize(os.path.join(ROOT, f)) for f in root_pngs()
             if os.path.getsize(os.path.join(ROOT, f)) > MAX_ROOT_PNG}
    assert heavy == {}, "over %d KB: %r" % (MAX_ROOT_PNG // 1024, heavy)


def test_the_logo_is_not_more_than_twice_its_display_size():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    m = re.search(r'<img[^>]*src="aol-figure\.png"[^>]*>', html)
    assert m, "the sign-on logo is not in the markup"
    tag = m.group(0)
    css_w = int(re.search(r'width="(\d+)"', tag).group(1))
    css_h = int(re.search(r'height="(\d+)"', tag).group(1))
    # a plain-width attribute is a CSS pixel; 2x is what a retina display needs
    # and anything past that is bytes nobody sees
    width, height = png_size(os.path.join(ROOT, "aol-figure.png"))
    assert width <= css_w * 2 and height <= css_h * 2, (width, height, css_w, css_h)


def test_the_page_has_no_unused_second_logo():
    assert not os.path.exists(os.path.join(ROOT, "aim-logo.png")), (
        "aim-logo.png was referenced nowhere; it is in git history if it is ever wanted")