#!/usr/bin/env bash
# Local launch. A server is required: browsers refuse ES modules over file://
set -e
cd "$(dirname "$0")"
PORT=8123
command -v python3 >/dev/null || { echo "Need python3"; exit 1; }
echo "http://localhost:$PORT — Ctrl+C to stop"
(sleep 1 && (xdg-open "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" 2>/dev/null || true)) &
python3 -m http.server $PORT
