#!/usr/bin/env bash
# 一键同步到服务器：./deploy/deploy.sh [user@host]
# 需指定目标主机；SSH 私钥路径可用 SSH_KEY 环境变量指定
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:?用法: ./deploy/deploy.sh user@your-server}"
KEY="${SSH_KEY:-webSever/abc-ubuntu.pem}"
SSH="ssh -i $KEY"
rsync -az --delete -e "$SSH" --exclude data/ --exclude webSever/ --exclude .claude/ --exclude __pycache__ ./ "$TARGET:/opt/epoch/"
$SSH "$TARGET" "sudo chgrp www-data /opt/epoch/.env && sudo chmod 640 /opt/epoch/.env && sudo mkdir -p /opt/epoch/data && sudo chown -R www-data:www-data /opt/epoch/data && sudo systemctl restart epoch && systemctl --no-pager status epoch | head -5"
