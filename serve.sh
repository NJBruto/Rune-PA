#!/usr/bin/env bash
# Serve Rune locally. ES modules require HTTP, not file://.
set -euo pipefail

PORT="${1:-8000}"
cd "$(dirname "$0")"

echo "Rune is available at http://127.0.0.1:${PORT}"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
