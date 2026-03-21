#!/bin/bash
# Observatory QA — Deployment / Update Script
# Run this on the EC2 instance to pull latest code and redeploy.
#
# Usage:
#   ssh ec2-user@YOUR_IP "sudo /opt/callanalyzer/deploy/ec2/deploy.sh"
#   OR from the instance:
#   sudo /opt/callanalyzer/deploy/ec2/deploy.sh [BRANCH]

set -euo pipefail

APP_DIR="/opt/callanalyzer"
APP_USER="callanalyzer"
BRANCH="${1:-main}"

echo "=== Observatory QA Deploy — $(date) ==="
echo "Branch: $BRANCH"

cd "$APP_DIR"

# --- Pre-flight checks ---
echo "--- Pre-flight checks ---"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "!!! ERROR: .env file not found at $ENV_FILE"
    echo "    Copy deploy/ec2/.env.example and fill in required values."
    exit 1
fi

# Verify critical env vars are set (not empty)
MISSING_VARS=()
for VAR in ASSEMBLYAI_API_KEY SESSION_SECRET; do
    if ! grep -qE "^${VAR}=.+" "$ENV_FILE"; then
        MISSING_VARS+=("$VAR")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "!!! WARNING: These required env vars appear empty in .env:"
    for VAR in "${MISSING_VARS[@]}"; do
        echo "    - $VAR"
    done
    echo "    Deploy will continue, but the app may not function correctly."
    echo ""
fi

# Pull latest code
echo "--- Pulling latest code ---"
sudo -u "$APP_USER" git fetch origin "$BRANCH"
sudo -u "$APP_USER" git checkout "$BRANCH"
sudo -u "$APP_USER" git pull origin "$BRANCH"

# Install dependencies
echo "--- Installing dependencies ---"
sudo -u "$APP_USER" npm ci --production=false

# Build
echo "--- Building ---"
sudo -u "$APP_USER" npm run build

# Prune dev dependencies
echo "--- Pruning dev dependencies ---"
sudo -u "$APP_USER" npm prune --production

# Restart the service
echo "--- Restarting Observatory QA ---"
systemctl restart callanalyzer

# Wait and check status
sleep 3
if systemctl is-active --quiet callanalyzer; then
    echo "--- Observatory QA is running ---"
    systemctl status callanalyzer --no-pager
else
    echo "!!! Observatory QA failed to start !!!"
    journalctl -u callanalyzer --no-pager -n 30
    exit 1
fi

echo ""
echo "=== Deploy complete — $(date) ==="
