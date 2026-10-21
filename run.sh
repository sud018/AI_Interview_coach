#!/usr/bin/env bash
# Start AI Interview Coach on macOS / Linux.  Usage: ./run.sh
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python || true)
if [ -z "$PY" ]; then
  echo "Python is not installed. Install Python 3.10+ from https://www.python.org/downloads/"
  exit 1
fi
if [ ! -x ".venv/bin/python" ]; then
  echo "Creating virtual environment..."
  "$PY" -m venv .venv
fi
echo "Installing / checking requirements..."
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt
echo "Starting AI Interview Coach... (press Ctrl+C to stop)"
exec .venv/bin/python app.py
