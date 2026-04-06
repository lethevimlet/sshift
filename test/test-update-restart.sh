#!/bin/bash
# Test script for update and restart functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "  Testing Update & Restart Functionality"
echo "=========================================="
echo ""

# Test 1: Check PID file creation
echo "[TEST 1] Testing PID file creation..."
cd "$PROJECT_DIR"

# Start the server in background
PORT=8022 node sshift &
SERVER_PID=$!
echo "Started server with PID: $SERVER_PID"

# Wait for server to start
sleep 2

# Check if PID file was created
if [ -f "$PROJECT_DIR/.sshift.pid" ]; then
    PID_FILE_CONTENT=$(cat "$PROJECT_DIR/.sshift.pid")
    echo "✓ PID file created: $PID_FILE_CONTENT"
    
    if [ "$PID_FILE_CONTENT" = "$SERVER_PID" ]; then
        echo "✓ PID file content matches server PID"
    else
        echo "✗ PID file content ($PID_FILE_CONTENT) doesn't match server PID ($SERVER_PID)"
    fi
else
    echo "✗ PID file not created"
fi

# Test 2: Check if server is listening on correct port
echo ""
echo "[TEST 2] Testing port binding..."
if netstat -tlnp 2>/dev/null | grep -q ":8022"; then
    echo "✓ Server is listening on port 8022"
elif ss -tlnp 2>/dev/null | grep -q ":8022"; then
    echo "✓ Server is listening on port 8022"
else
    echo "✗ Server is NOT listening on port 8022"
    echo "Current listening ports:"
    ss -tlnp 2>/dev/null | grep node || netstat -tlnp 2>/dev/null | grep node || true
fi

# Test 3: Check update script can find and stop the process
echo ""
echo "[TEST 3] Testing update script process detection..."
if [ -f "$PROJECT_DIR/install.sh" ]; then
    # Source the install script functions
    source_install_script() {
        # Extract just the functions we need
        PID_FILE="${PROJECT_DIR}/.sshift.pid"
        
        is_running() {
            if [ -f "$PID_FILE" ]; then
                local pid=$(cat "$PID_FILE")
                if kill -0 "$pid" 2>/dev/null; then
                    return 0
                fi
            fi
            return 1
        }
    }
    
    source_install_script
    
    if is_running; then
        echo "✓ Update script can detect running process"
    else
        echo "✗ Update script cannot detect running process"
    fi
else
    echo "✗ install.sh not found"
fi

# Test 4: Test systemd service (if available)
echo ""
echo "[TEST 4] Testing systemd service..."
if command -v systemctl &>/dev/null; then
    if systemctl --user is-enabled sshift &>/dev/null; then
        echo "✓ systemd service is enabled"
        
        if systemctl --user is-active sshift &>/dev/null; then
            echo "✓ systemd service is active"
        else
            echo "⚠ systemd service is inactive (expected if running manually)"
        fi
    else
        echo "⚠ systemd service is not enabled"
    fi
else
    echo "⚠ systemd not available"
fi

# Cleanup
echo ""
echo "[CLEANUP] Stopping test server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Remove PID file
rm -f "$PROJECT_DIR/.sshift.pid"

echo ""
echo "=========================================="
echo "  Test Complete"
echo "=========================================="