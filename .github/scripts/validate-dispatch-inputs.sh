#!/usr/bin/env bash
# Validates the workflow_dispatch inputs of collect-audit.yml. The inputs reach this script only
# through the environment (never interpolated into a shell command), are checked against a strict
# allowlist, and are written to GITHUB_OUTPUT only after that. The value is never echoed back.
#
#   RETENTION_DAYS  empty (use retention.snapshotDays) or an integer 1-99999
#   DRY_RUN         empty, "true" or "false"
set -euo pipefail

retention="${RETENTION_DAYS:-}"
dry_run="${DRY_RUN:-}"

if [ -n "$retention" ] && ! [[ "$retention" =~ ^[1-9][0-9]{0,4}$ ]]; then
  echo "::error::retention_days must be a whole number from 1 to 99999 (or empty)" >&2
  exit 1
fi
case "$dry_run" in
  '' | true | false) ;;
  *)
    echo "::error::dry_run must be true or false" >&2
    exit 1
    ;;
esac

{
  echo "retention_days=$retention"
  echo "dry_run=${dry_run:-false}"
} >>"${GITHUB_OUTPUT:-/dev/stdout}"
