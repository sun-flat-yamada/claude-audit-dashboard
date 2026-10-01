#!/usr/bin/env bash
# Fork-safe storage for live audit data: the orphan branch `data/audit` (never main).
#
#   data-branch.sh restore            copy data/ from the branch into the working tree
#   data-branch.sh save "<message>"   commit the working tree's data/ to the branch and push
#
# `save` mirrors data/ (deletions included, e.g. archived snapshots), so it must follow a
# successful `restore` in the same job. data/sample/ and .gitkeep files are never copied.
set -euo pipefail

BRANCH="${DATA_BRANCH:-data/audit}"
DATA_DIR="data"
STAMP="$(git rev-parse --git-dir)/data-branch-restored"

branch_exists() {
  local status=0
  git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null || status=$?
  [ "$status" -eq 0 ] && return 0
  [ "$status" -eq 2 ] && return 1
  echo "::error::Could not query origin for $BRANCH (exit $status)" >&2
  exit "$status"
}

restore() {
  if branch_exists; then
    git fetch --quiet --depth=1 origin "$BRANCH"
    git archive FETCH_HEAD "$DATA_DIR" | tar -x
    echo "Restored $DATA_DIR/ from $BRANCH ($(git rev-parse --short FETCH_HEAD))"
  else
    echo "No $BRANCH branch yet: starting without stored data"
  fi
  touch "$STAMP"
}

save() {
  local message="$1" worktree
  [ -f "$STAMP" ] || { echo "::error::Run 'data-branch.sh restore' before 'save'" >&2; exit 1; }
  worktree="$(mktemp -d)"
  # shellcheck disable=SC2064 # expand now: the variable is local to this function
  trap "git worktree remove --force '$worktree' >/dev/null 2>&1 || true" EXIT
  if branch_exists; then
    git fetch --quiet --depth=1 origin "$BRANCH"
    git worktree add --quiet --detach "$worktree" FETCH_HEAD
  else
    git worktree add --quiet --detach "$worktree"
    git -C "$worktree" checkout --quiet --orphan "$BRANCH"
    git -C "$worktree" rm -rq --cached .
    git -C "$worktree" clean -fdxq
  fi
  rm -rf "${worktree:?}/$DATA_DIR"
  cp -R "$DATA_DIR" "$worktree/$DATA_DIR"
  rm -rf "$worktree/$DATA_DIR/sample"
  find "$worktree/$DATA_DIR" -name .gitkeep -delete
  git -C "$worktree" add -A "$DATA_DIR"
  if git -C "$worktree" diff --cached --quiet; then
    echo "No data changes to save"
  else
    git -C "$worktree" -c user.name='github-actions[bot]' \
      -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
      commit --quiet -m "$message"
    git -C "$worktree" push --quiet origin "HEAD:refs/heads/$BRANCH"
    echo "Saved $DATA_DIR/ to $BRANCH"
  fi
}

case "${1:-}" in
  restore) restore ;;
  save) save "${2:?commit message required}" ;;
  *) echo "usage: $0 restore | save <message>" >&2; exit 64 ;;
esac
