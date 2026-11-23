"""Where a question routes when the backend cannot be reached.

The router is a keyword list, so these are the cases that make it or break it:
the two that used to misfire ("sleeping right" scored as a rights question,
"emergency contact" as a crisis), and the plainest English disclosure, which
used to miss the crisis block entirely.
"""
import pytest

from conftest import API_GLOB, sign_on

CASES = [
    # question, the canned block it must reach
    ("my husband is hitting me and I want to die", "crisisAnswer"),
    ("I don't want to live anymore", "crisisAnswer"),
    ("my child is unsafe at home", "crisisAnswer"),
    ("my son just failed his hearing test, what now", "fallbackAnswer"),
    ("my child isn't sleeping right", "fallbackAnswer"),
    ("emergency contact for the audiologist", "fallbackAnswer"),
    ("what rights does my child have at school", "crpdAnswer"),
    ("the district says she needs an IEP", "crpdAnswer"),
    ("will sign language stop my child from learning to speak", "aslCiAnswer"),
    ("what is language deprivation", "deprivationAnswer"),
]


@pytest.mark.parametrize("question,expected", CASES)
def test_question_routes_to_the_expected_block(app_page, question, expected):
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda route: route.abort())
    sign_on(app_page)
    app_page.fill("#chatInput", question)
    app_page.press("#chatInput", "Enter")
    app_page.wait_for_selector("#chatTranscript [data-canned]", timeout=30000)
    got = app_page.eval_on_selector(
        "#chatTranscript [data-canned]", "el => el.getAttribute('data-canned')")
    assert got == expected, "%r routed to %s, expected %s" % (question, got, expected)


def test_the_crisis_block_leads_with_the_lifeline(app_page):
    app_page.unroute(API_GLOB)
    app_page.route(API_GLOB, lambda route: route.abort())
    sign_on(app_page)
    app_page.fill("#chatInput", "I don't want to live anymore")
    app_page.press("#chatInput", "Enter")
    app_page.wait_for_selector("#chatTranscript [data-canned='crisisAnswer']", timeout=30000)
    text = app_page.inner_text("#chatTranscript [data-canned='crisisAnswer']")
    assert "988" in text
    assert text.index("988") < len(text) / 2, "resources should lead, not trail"