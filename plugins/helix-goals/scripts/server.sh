#!/bin/bash
# Helix Server Management Script
# Usage: ./scripts/server.sh [start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$APP_DIR/.server.pid"
LOG_FILE="$APP_DIR/server.log"
PORT="${PORT:-9011}"

start() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Server already running (PID: $PID)"
            return 1
        fi
        rm -f "$PID_FILE"
    fi

    echo "Starting Helix server on port $PORT..."
    cd "$APP_DIR"
    # Use setsid to fully detach from terminal/parent process
    setsid node index.js > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 2
    
    if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "Server started (PID: $(cat "$PID_FILE"))"
        echo "Logs: $LOG_FILE"
    else
        echo "Failed to start server. Check $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "No PID file found. Server not running?"
        # Try to find and kill anyway
        PID=$(pgrep -f "node.*strand-management/index.js" | head -1)
        if [ -n "$PID" ]; then
            echo "Found orphan process $PID, killing..."
            kill "$PID" 2>/dev/null
        fi
        return 0
    fi

    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping server (PID: $PID)..."
        kill "$PID"
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            echo "Force killing..."
            kill -9 "$PID" 2>/dev/null
        fi
        echo "Server stopped"
    else
        echo "Server was not running"
    fi
    rm -f "$PID_FILE"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Server running (PID: $PID)"
            echo "Port: $PORT"
            return 0
        fi
    fi
    
    # Check for orphan process
    PID=$(pgrep -f "node.*strand-management/index.js" | head -1)
    if [ -n "$PID" ]; then
        echo "Server running (orphan PID: $PID)"
        return 0
    fi
    
    echo "Server not running"
    return 1
}

case "$1" in
    start)   start ;;
    stop)    stop ;;
    restart) restart ;;
    status)  status ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
