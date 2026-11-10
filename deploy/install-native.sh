#!/bin/sh
# Run as root inside a dedicated Debian CT after copying the project to /opt/hydrantenkarte.
set -eu
cd /opt/hydrantenkarte
npm ci --omit=dev
id hydrantenkarte >/dev/null 2>&1 || useradd --system --home /opt/hydrantenkarte --shell /usr/sbin/nologin hydrantenkarte
chown -R root:root /opt/hydrantenkarte
chmod -R a+rX /opt/hydrantenkarte
if [ ! -f /etc/hydrantenkarte.env ]; then
  cp .env.example /etc/hydrantenkarte.env
  echo HOST=127.0.0.1 >> /etc/hydrantenkarte.env
  chmod 600 /etc/hydrantenkarte.env
fi
cp deploy/hydrantenkarte.service /etc/systemd/system/hydrantenkarte.service
systemctl daemon-reload
systemctl enable --now hydrantenkarte
