#!/bin/bash
# Observatory QA — EC2 User Data (bootstrap) Script
# This runs once on first boot when launching the EC2 instance.
#
# Usage: Paste into EC2 Launch → Advanced Details → User Data
#        OR pass via: aws ec2 run-instances --user-data file://deploy/ec2/user-data.sh
#
# Prerequisites:
#   - Amazon Linux 2023 AMI (al2023-ami-*)
#   - t3.micro instance type
#   - Security group with ports 22, 80, 443 open
#   - IAM role with S3 + Bedrock access attached to the instance

set -euo pipefail
exec > >(tee /var/log/observatory-qa-setup.log) 2>&1

# === REQUIRED: Set these before running ===
DOMAIN="${DOMAIN:?'Set DOMAIN env var (e.g., qa.yourcompany.com)'}"
REPO_URL="${REPO_URL:?'Set REPO_URL env var (e.g., https://github.com/org/observatory-qa.git)'}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}"

echo "=== Observatory QA EC2 Setup — $(date) ==="

# --- System updates ---
dnf update -y

# --- Install Node.js 20 LTS ---
dnf install -y nodejs20 npm git

# Verify
node --version
npm --version

# --- Install Caddy ---
dnf install -y 'dnf-command(copr)'
dnf copr enable -y @caddy/caddy
dnf install -y caddy

# --- Create application user ---
useradd --system --shell /usr/sbin/nologin --home-dir /opt/callanalyzer callanalyzer
mkdir -p /opt/callanalyzer
chown callanalyzer:callanalyzer /opt/callanalyzer

# --- Create Caddy log directory ---
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy

# --- Clone and build the application ---
cd /opt/callanalyzer
git clone "$REPO_URL" .
npm ci --production=false
npm run build
npm prune --production

# --- Create .env ---
# IMPORTANT: Fill in the placeholder values after first boot!
cat > /opt/callanalyzer/.env << ENVFILE
# === REQUIRED ===
ASSEMBLYAI_API_KEY=              # Get from https://www.assemblyai.com/
SESSION_SECRET=${SESSION_SECRET}

# === Authentication ===
# Format: username:password:role:displayName:orgSlug (comma-separated for multiple)
AUTH_USERS=                      # e.g., admin:securepassword:admin:Admin User:my-org

# === AWS (Bedrock AI + S3 Storage) ===
# If using an IAM instance role, you can omit these — the app uses the role automatically
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1

# === Storage ===
S3_BUCKET=                       # Your S3 bucket name for audio storage

# === Optional ===
PORT=5000
RETENTION_DAYS=90
ENVFILE

chown callanalyzer:callanalyzer /opt/callanalyzer/.env
chmod 600 /opt/callanalyzer/.env

# --- Install systemd service ---
# NOTE: Copy the service file from the repo after cloning:
# cp /opt/callanalyzer/deploy/ec2/callanalyzer.service /etc/systemd/system/
# For now, create it inline:
cat > /etc/systemd/system/callanalyzer.service << 'SERVICEFILE'
[Unit]
Description=Observatory QA - AI-Powered Call Quality Analysis
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=callanalyzer
Group=callanalyzer
WorkingDirectory=/opt/callanalyzer
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=5000
EnvironmentFile=/opt/callanalyzer/.env
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/callanalyzer
PrivateTmp=true
PrivateDevices=true
LimitNOFILE=65535
MemoryMax=1G
StandardOutput=journal
StandardError=journal
SyslogIdentifier=callanalyzer

[Install]
WantedBy=multi-user.target
SERVICEFILE

systemctl daemon-reload
systemctl enable callanalyzer

# --- Install Caddyfile ---
cat > /etc/caddy/Caddyfile << CADDYFILE
${DOMAIN} {
    reverse_proxy localhost:5000

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        -Server
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 50mb
            roll_keep 10
            roll_keep_for 90d
        }
        format json
    }

    request_body {
        max_size 50MB
    }
}
CADDYFILE

systemctl enable caddy

# --- Enable EBS encryption (reminder) ---
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Next steps:"
echo "  1. Edit /opt/callanalyzer/.env with real credentials"
echo "  2. Point your domain's DNS A record to this instance's public IP"
echo "  3. Start services: sudo systemctl start callanalyzer && sudo systemctl start caddy"
echo "  4. Verify: curl https://${DOMAIN}/api/auth/me"
echo ""
