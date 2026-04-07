#!/bin/bash
# Test the complete update flow including restart

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "  Testing Complete Update Flow"
echo "=========================================="
echo ""

# Source the install script functions
source_install_functions() {
    # Extract PID_FILE variable
    export PID_FILE="${PROJECT_DIR}/.sshift.pid"
    export SERVICE_NAME="sshift"
    
    # Define the functions from install.sh
    is_running() {
        if [ -f "$PID_FILE" ]; then
            local pid=$(cat "$PID_FILE")
            if kill -0 "$pid" 2>/dev/null; then
                return 0
            fi
        fi
        return 1
    }
    
    command_exists() {
        command -v "$1" >/dev/null 2>&1
    }
    
    stop_app() {
        # Check if running via systemd
        if command_exists systemctl && systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo "Stopping sshift via systemd..."
            systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
            sleep 2
            return
        fi
        
        # Otherwise, stop via PID file
        if is_running; then
            local pid=$(cat "$PID_FILE")
            echo "Stopping sshift (PID: $pid)..."
            kill "$pid" 2>/dev/null || true
            rm -f "$PID_FILE"
            sleep 1
        fi
    }
    
    start_app() {
        echo "Starting sshift..."
        
        # Check if systemd service is enabled
        if command_exists systemctl && systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo "Starting via systemd service..."
            systemctl --user start "$SERVICE_NAME" 2>/dev/null || {
                echo "Failed to start via systemd, falling back to direct start"
                # Fall through to direct start below
            }
            
            # Give systemd a moment to start
            sleep 2
            
            # Check if it started successfully
            if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
                echo "sshift started via systemd"
                return 0
            fi
        fi
        
        # Direct start (no systemd or systemd failed)
        cd "$PROJECT_DIR"
        
        # Start the server
        PORT=8022 node sshift > /dev/null 2>&1 &
        local pid=$!
        
        # Wait for server to start
        sleep 2
        
        # Write PID file
        echo $pid > "$PID_FILE"
        echo "sshift started (PID: $pid)"
    }
}

# Load functions
source_install_functions

# Test 1: Check current state
echo "[TEST 1] Checking current state..."
if is_running; then
    PID=$(cat "$PID_FILE")
    echo "✓ App is running (PID: $PID)"
    
    # Check port
    if ss -tlnp 2>/dev/null | grep -q ":8022"; then
        echo "✓ App is listening on port 8022"
    else
        echo "✗ App is NOT listening on port 8022"
        exit 1
    fi
else
    echo "✗ App is not running"
    exit 1
fi

# Test 2: Test stop_app function
echo ""
echo "[TEST 2] Testing stop_app function..."
stop_app
sleep 2

if is_running; then
    echo "✗ App is still running after stop_app"
    exit 1
else
    echo "✓ App stopped successfully"
fi

# Verify port is released
if ss -tlnp 2>/dev/null | grep -q ":8022"; then
    echo "✗ Port 8022 is still in use"
    exit 1
else
    echo "✓ Port 8022 is released"
fi

# Test 3: Test start_app function
echo ""
echo "[TEST 3] Testing start_app function..."
start_app
sleep 3

if is_running; then
    NEW_PID=$(cat "$PID_FILE")
    echo "✓ App started successfully (PID: $NEW_PID)"
    
    # Verify it's listening on port 8022
    if ss -tlnp 2>/dev/null | grep -q ":8022"; then
        echo "✓ App is listening on port 8022"
    else
        echo "✗ App is NOT listening on port 8022"
        exit 1
    fi
else
    echo "✗ App failed to start"
    exit 1
fi

# Test 4: Verify PID file is correct
echo ""
echo "[TEST 4] Verifying PID file..."
if [ -f "$PID_FILE" ]; then
    FILED_PID=$(cat "$PID_FILE")
    ACTUAL_PID=$(pgrep -f "node sshift" | head -1)
    
    if [ "$FILED_PID" = "$ACTUAL_PID" ]; then
        echo "✓ PID file matches actual process"
    else
        echo "⚠ PID file ($FILED_PID) differs from actual process ($ACTUAL_PID)"
        echo "  This may be expected if multiple instances are running"
    fi
else
    echo "✗ PID file not found"
    exit 1
fi

# Test 5: Test HTTP endpoint
echo ""
echo "[TEST 5] Testing HTTP endpoint..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8022)
if [ "$RESPONSE" = "200" ]; then
    echo "✓ HTTP endpoint responding (status: $RESPONSE)"
else
    echo "✗ HTTP endpoint not responding (status: $RESPONSE)"
    exit 1
fi

echo ""
echo "=========================================="
echo "  All Tests Passed!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - App can be stopped successfully"
echo "  - App can be started successfully"
echo "  - PID file is created and valid"
echo "  - App listens on port 8022"
echo "  - HTTP endpoint is accessible"
echo ""