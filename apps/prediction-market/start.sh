#!/bin/bash
# Start the Prediction Market Agent

cd "$(dirname "$0")"

# Create virtual environment if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate and install deps
source venv/bin/activate
pip install -q -r backend/requirements.txt

# Start server
echo "Starting Prediction Market Agent on port 8765..."
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
uvicorn backend.main:app --host 0.0.0.0 --port 8765 --reload
