#!/usr/bin/env bash
# Validates the workflow_dispatch input of ledger-seal.yml (same pattern as
# validate-dispatch-inputs.sh). The input reaches this script only through the environment (never
# interpolated into a shell command), is checked against a strict allowlist, and is written to
# GITHUB_OUTPUT only after that. The value is never echoed back.
#
#   MONTH  empty (the previous month) or a month yyyy-mm (2000-01 .. 2099-12)
set -euo pipefail

month="${MONTH:-}"

if [ -n "$month" ] && ! [[ "$month" =~ ^20[0-9]{2}-(0[1-9]|1[0-2])$ ]]; then
  echo "::error::month must be a month in the form yyyy-mm (or empty)" >&2
  exit 1
fi

echo "month=$month" >>"${GITHUB_OUTPUT:-/dev/stdout}"
