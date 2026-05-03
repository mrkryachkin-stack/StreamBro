#!/bin/bash
# StreamBro Server — Setup Script
# Run on VPS (see VPS_IP in secrets)
# Usage: bash setup.sh
#
# This script:
# 1. Installs Node.js, pm2, nginx, certbot if needed
# 2. Copies server files to /opt/streambro
# 3. Installs npm dependencies
# 4. Configures nginx reverse proxy
# 5. Sets up pm2 for auto-start
# 6. Requests SSL certificates (when DNS is ready)

set -e

echo "========================================="
echo "  StreamBro Server Setup"
echo "========================================="

# ─── 1. Install system packages ───
echo ""
echo "[1/7] Installing system packages..."

apt update -y

# Node.js 22 LTS
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
else
  echo "  Node.js $(node -v) already installed"
fi

# pm2
if ! command -v pm2 &>/dev/null; then
  echo "  Installing pm2..."
  npm install -g pm2
else
  echo "  pm2 $(pm2 -v) already installed"
fi

# nginx
if ! command -v nginx &>/dev/null; then
  echo "  Installing nginx..."
  apt install -y nginx
else
  echo "  nginx already installed"
fi

# certbot
if ! command -v certbot &>/dev/null; then
  echo "  Installing certbot..."
  apt install -y certbot python3-certbot-nginx
else
  echo "  certbot already installed"
fi

# ─── 2. Deploy server files ───
echo ""
echo "[2/7] Deploying server files to /opt/streambro..."

mkdir -p /opt/streambro/data/bugs
mkdir -p /opt/streambro/data/updates
mkdir -p /opt/streambro/downloads
mkdir -p /opt/streambro/logs

# Copy files from current directory (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cp "$SCRIPT_DIR/server.js"       /opt/streambro/server.js
cp "$SCRIPT_DIR/signaling.js"    /opt/streambro/signaling.js
cp "$SCRIPT_DIR/package.json"    /opt/streambro/package.json

# Create .env if not exists
if [ ! -f /opt/streambro/.env ]; then
  cp "$SCRIPT_DIR/.env.example" /opt/streambro/.env
  # Generate random admin secret
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/change-me-to-a-strong-secret/$SECRET/" /opt/streambro/.env
  echo "  Generated ADMIN_SECRET: $SECRET"
  echo "  SAVE THIS! It's in /opt/streambro/.env"
fi

# ─── 3. Install npm dependencies ───
echo ""
echo "[3/7] Installing npm dependencies..."

cd /opt/streambro
npm install --production

# ─── 4. Configure nginx ───
echo ""
echo "[4/7] Configuring nginx..."

cat > /etc/nginx/sites-available/streambro << 'NGINX_EOF'
# StreamBro — Nginx configuration

# Main site
server {
    listen 80;
    server_name streambro.online www.streambro.online;
    root /var/www/streambro;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location /downloads/ {
        alias /opt/streambro/downloads/;
        autoindex off;
    }
}

# API
server {
    listen 80;
    server_name api.streambro.online;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Signaling (WebSocket)
server {
    listen 80;
    server_name signaling.streambro.online;

    location / {
        proxy_pass http://127.0.0.1:7890;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}

# Updates (static files)
server {
    listen 80;
    server_name updates.streambro.online;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_EOF

# Enable site
ln -sf /etc/nginx/sites-available/streambro /etc/nginx/sites-enabled/streambro
rm -f /etc/nginx/sites-enabled/default

# Test config
nginx -t

echo "  Nginx configured. Run 'systemctl reload nginx' when DNS is ready."

# ─── 5. Create minimal website ───
echo ""
echo "[5/7] Creating website placeholder..."

mkdir -p /var/www/streambro/downloads

if [ ! -f /var/www/streambro/index.html ]; then
  cat > /var/www/streambro/index.html << 'HTML_EOF'
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StreamBro — Streaming for Everyone</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d0d12; color: #e0e0e8; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .container { text-align: center; max-width: 600px; padding: 40px; }
        h1 { font-size: 3rem; background: linear-gradient(135deg, #6c5ce7, #a29bfe); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 16px; }
        p { font-size: 1.1rem; color: #888; margin-bottom: 24px; line-height: 1.6; }
        .download { display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 1.1rem; transition: transform 0.2s, box-shadow 0.2s; }
        .download:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(108,92,231,0.4); }
        .sub { margin-top: 12px; font-size: 0.85rem; color: #555; }
        .links { margin-top: 40px; display: flex; gap: 20px; justify-content: center; }
        .links a { color: #6c5ce7; text-decoration: none; font-size: 0.9rem; }
        .links a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>StreamBro</h1>
        <p>Компактный профессиональный стриминг-композитор для Windows.<br>Стримь на Twitch, YouTube, Kick — проще, чем в OBS.</p>
        <a class="download" href="/downloads/StreamBro-1.1.0-portable.zip">Скачать StreamBro 1.1.0</a>
        <div class="sub">Windows 10/11 • Portable ZIP • 200 MB</div>
        <div class="links">
            <a href="https://github.com/mrkryachkin-stack/StreamBro">GitHub</a>
            <a href="https://api.streambro.online/health">API Status</a>
        </div>
    </div>
</body>
</html>
HTML_EOF
fi

# ─── 6. Start services with pm2 ───
echo ""
echo "[6/7] Starting services with pm2..."

cd /opt/streambro

pm2 delete streambro-api 2>/dev/null || true
pm2 delete streambro-signal 2>/dev/null || true

pm2 start server.js --name streambro-api --log logs/api.log --error logs/api-error.log
pm2 start signaling.js --name streambro-signal --log logs/signal.log --error logs/signal-error.log

pm2 save
pm2 startup 2>/dev/null || echo "  Run 'pm2 startup' manually and follow instructions"

# ─── 7. Start nginx ───
echo ""
echo "[7/7] Starting nginx..."

systemctl enable nginx
systemctl restart nginx

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Services running:"
echo "    - API:        http://localhost:3000"
echo "    - Signaling:  ws://localhost:7890"
echo "    - Nginx:      http://localhost:80"
echo ""
echo "  Next steps:"
echo "    1. Configure DNS (see AGENTS.md section 8)"
echo "    2. Run SSL:  certbot --nginx -d streambro.online -d api.streambro.online -d signaling.streambro.online -d updates.streambro.online"
echo "    3. Copy portable .zip to /opt/streambro/downloads/"
echo "    4. Test API:  curl http://localhost:3000/health"
echo "    5. Admin secret is in /opt/streambro/.env"
echo ""
