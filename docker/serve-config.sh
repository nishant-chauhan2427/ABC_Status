#!/bin/sh
# Writes serve.json for the status page: `serve-config.sh <base path> > dist/serve.json`.
#
# "/" redirects to the base path, which serves index.html. Upptime's app-only routes
# (incident, history, error pages) are not exported as files, so they get 404.html,
# which loads the app — the same way GitHub Pages serves them. Each route is its own
# rule: serve re-applies rewrites to an already rewritten path, so a catch-all would
# swallow index.html too. No folder listings.
set -eu
b="${1:-}"
app="$b/404.html"
redirects=""
[ -n "$b" ] && redirects="{ \"source\": \"/\", \"destination\": \"$b/\", \"type\": 302 }"
cat <<JSON
{
  "directoryListing": false,
  "redirects": [$redirects],
  "rewrites": [
    { "source": "$b/incident/**", "destination": "$app" },
    { "source": "$b/history/**", "destination": "$app" },
    { "source": "$b/error", "destination": "$app" },
    { "source": "$b/rate-limit-exceeded", "destination": "$app" }
  ]
}
JSON
