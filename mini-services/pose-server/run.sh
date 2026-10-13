#!/usr/bin/env bash
# Start the Nuhoud Pose Inference Server on port 8001.
# Uses the project venv's python3 (where mediapipe / fastapi are installed).
set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8001}"

# --reload off because MediaPipe allocates native resources that don't play
# well with uvicorn's reloader forking. Use --log-level info in prod.
exec python3 -m uvicorn main:app \
    --host "$HOST" \
    --port "$PORT" \
    --log-level info \
    --ws-max-size 8388608
