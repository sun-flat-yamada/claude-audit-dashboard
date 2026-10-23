#!/usr/bin/env bash
# Lets the month-end schedule of collect-audit.yml (#160) run only on the last day of the month:
# cron cannot say "last day", so the schedule fires on the 28th-31st and this guard checks that
# the next UTC day is the 1st. Every other trigger (the 6-hourly schedule, manual runs) runs.
#
#   SCHEDULE     the cron expression that triggered the run (github.event.schedule), may be empty
#   GUARD_TODAY  optional yyyy-mm-dd instead of the current UTC date (tests)
#
# Writes run=true|false to GITHUB_OUTPUT.
set -euo pipefail

readonly MONTH_END_CRON='30 23 28-31 * *'

schedule="${SCHEDULE:-}"
today="${GUARD_TODAY:-$(date -u +%Y-%m-%d)}"

if ! [[ "$today" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$ ]]; then
  echo "::error::GUARD_TODAY must be a date in the form yyyy-mm-dd" >&2
  exit 1
fi

run=true
if [ "$schedule" = "$MONTH_END_CRON" ]; then
  tomorrow="$(date -u -d "$today + 1 day" +%d)"
  if [ "$tomorrow" != "01" ]; then
    run=false
    echo "Month-end schedule: $today is not the last day of the month, skipping"
  fi
fi

echo "run=$run" >>"${GITHUB_OUTPUT:-/dev/stdout}"
