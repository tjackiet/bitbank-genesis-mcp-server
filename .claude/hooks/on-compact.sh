#!/usr/bin/env bash
set -euo pipefail
# Purpose: Signal to the Stop hook that this stop was triggered by compact.
# The Stop hook checks for this flag and skips test execution.
touch /tmp/.claude-compact-in-progress
