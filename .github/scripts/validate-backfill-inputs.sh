#!/usr/bin/env bash
# Validates the workflow_dispatch inputs of ledger-backfill.yml (same pattern as
# validate-dispatch-inputs.sh). The inputs reach this script only through the environment (never
# interpolated into a shell command), are checked against a strict allowlist, and are written to
# GITHUB_OUTPUT only after that. The values are never echoed back.
#
#   FROM      required month yyyy-mm (2000-01 .. 2099-12)
#   TO        empty (the current month) or a month yyyy-mm
#   DATASETS  empty (the default set) or a comma-separated list of dataset names (letters only)
#   FORCE     empty, "true" or "false"
set -euo pipefail

from="${FROM:-}"
to="${TO:-}"
datasets="${DATASETS:-}"
force="${FORCE:-}"

month='^20[0-9]{2}-(0[1-9]|1[0-2])$'

if ! [[ "$from" =~ $month ]]; then
  echo "::error::from must be a month in the form yyyy-mm" >&2
  exit 1
fi
if [ -n "$to" ] && ! [[ "$to" =~ $month ]]; then
  echo "::error::to must be a month in the form yyyy-mm (or empty)" >&2
  exit 1
fi
if [ -n "$datasets" ] && ! [[ "$datasets" =~ ^[a-zA-Z]{1,40}(,[a-zA-Z]{1,40}){0,19}$ ]]; then
  echo "::error::datasets must be dataset names (letters only) separated by single commas (or empty)" >&2
  exit 1
fi
case "$force" in
  '' | true | false) ;;
  *)
    echo "::error::force must be true or false" >&2
    exit 1
    ;;
esac

{
  echo "from=$from"
  echo "to=$to"
  echo "datasets=$datasets"
  echo "force=${force:-false}"
} >>"${GITHUB_OUTPUT:-/dev/stdout}"
