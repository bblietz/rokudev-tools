#!/usr/bin/env bash
# scripts/ci-bootstrap.sh
# Activates pnpm via corepack; falls back to npm-installed pnpm pin if corepack unavailable.
# Used by external CI environments that do not pre-install pnpm.

set -euo pipefail

PNPM_PIN="10.33.2"

if command -v corepack >/dev/null 2>&1; then
  corepack enable
  corepack prepare "pnpm@${PNPM_PIN}" --activate
elif command -v npm >/dev/null 2>&1; then
  npm install -g "pnpm@${PNPM_PIN}"
else
  echo "ERROR: neither corepack nor npm available; cannot install pnpm." >&2
  exit 1
fi

pnpm --version
