#!/usr/bin/env bash
# Start Firebase emulators with Gmail OAuth env for local Connect / Sync testing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${GMAIL_ENV_FILE:-$ROOT/functions/gmail.env.local}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy functions/gmail.env.example → functions/gmail.env.local and fill Client ID/Secret."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" || -z "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]]; then
  echo "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in $ENV_FILE"
  exit 1
fi

export GMAIL_OAUTH_REDIRECT_URI="${GMAIL_OAUTH_REDIRECT_URI:-http://127.0.0.1:5001/demo-project/asia-south1/gmailOAuthCallback}"

echo "Building functions…"
npm run build:functions

echo "Starting emulators with Gmail OAuth…"
echo "  Redirect URI: $GMAIL_OAUTH_REDIRECT_URI"
echo "  (Add this exact URI on your Google OAuth Web client)"
exec npm run emulators:persist
