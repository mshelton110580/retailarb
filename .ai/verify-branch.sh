#!/bin/bash
# /.ai/verify-branch.sh
# Exits nonzero unless the current git branch is arbdesk-dev.
# Used by deploy scripts and AI workflow steps.

REQUIRED_BRANCH="arbdesk-dev"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$CURRENT_BRANCH" != "$REQUIRED_BRANCH" ]; then
  echo "ERROR: Current branch is '$CURRENT_BRANCH'. Must be on '$REQUIRED_BRANCH'." >&2
  echo "Run: git checkout $REQUIRED_BRANCH" >&2
  exit 1
fi

echo "OK: On branch $REQUIRED_BRANCH"
exit 0
