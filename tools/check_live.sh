#!/bin/sh
# Probe the live deploy from the outside.
#
# Two things go wrong with a static host and neither is visible from the repo:
# a page that 404s or loads without one of its files, and a deploy that starts
# serving the repository again. Both are curls, so this is the check that runs
# on a schedule.
#
#   sh tools/check_live.sh                       # the live site
#   BASE_URL=http://127.0.0.1:8080 sh tools/check_live.sh
#
# Exits 0 when everything answers as expected, 1 with the failing path named.
set -eu

BASE_URL=${BASE_URL:-https://claytonvlawson.github.io/learnwithclayparentadvisor}
fail=0

status() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 20 --retry 2 --retry-delay 3 "$1" 2>/dev/null || echo 000
}

# 1. the page and every file it loads on a first visit, plus one language table
for path in / /index.html /i18n.js /i18n/es.js /assets/app.js /assets/styles.css \
            /aol-figure.png /win-flag.png /docs/im-window.png; do
  code=$(status "$BASE_URL$path")
  if [ "$code" = "200" ]; then
    echo "ok   200 $path"
  else
    echo "FAIL $code $path"
    fail=1
  fi
done

# 2. the repository must not be reachable. These were served before the deploy
#    was staged, so a regression here is a regression in publishing.
for path in /app.py /tests/test_chat.py /README.md /requirements-dev.txt /security.json; do
  code=$(status "$BASE_URL$path")
  if [ "$code" = "404" ]; then
    echo "ok   404 $path (not published)"
  else
    echo "FAIL $code $path (the repository is being served)"
    fail=1
  fi
done

# 3. the page still is the page: a title, the CSP meta tag, and the runtime small
#    enough to mean the translation tables are not back inside it
html=$(curl -sS --max-time 20 "$BASE_URL/" || true)
case $html in
  *"Parent Advisor: AIM Edition"*) echo "ok   title" ;;
  *) echo "FAIL title missing from the served page"; fail=1 ;;
esac
case $html in
  *'http-equiv="Content-Security-Policy"'*) echo "ok   meta CSP" ;;
  *) echo "FAIL no CSP meta tag in the served page"; fail=1 ;;
esac

runtime=$(curl -sS --max-time 20 "$BASE_URL/i18n.js" | wc -c | tr -d ' ')
if [ "$runtime" -lt 40960 ]; then
  echo "ok   i18n.js ${runtime}B"
else
  echo "FAIL i18n.js is ${runtime}B: the language tables are back in the runtime"
  fail=1
fi

exit $fail