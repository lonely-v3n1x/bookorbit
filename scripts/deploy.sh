#!/usr/bin/env bash
# Deploy the latest prebuilt image from the registry (no local build).
#
# The image is built on GitHub Actions (.github/workflows/container-image.yml)
# and published as ${APP_IMAGE:-ghcr.io/<owner>/<repo>:main}. This script
# pulls it and restarts the stack. Great for small hosts where compiling the
# app locally is too slow or OOMs (e.g. 1GB VPS).
#
# Usage:  ./scripts/deploy.sh
# Env:    APP_IMAGE   image tag to pull (default ghcr.io/<owner>/<repo>:main)
#
# Optional local overrides are auto-included when present:
#   docker-compose.mem.yml    memory tuning for low-RAM hosts
#   docker-compose.caddy.yml  HTTPS reverse proxy
set -euo pipefail
cd "$(dirname "$0")/.."

EXTRAS=()
for f in docker-compose.mem.yml docker-compose.caddy.yml; do
  [ -f "$f" ] && EXTRAS+=(-f "$f")
done

echo ">> Pulling latest app image..."
docker compose -f docker-compose.yml "${EXTRAS[@]}" pull app

echo ">> Recreating app container from prebuilt image (--no-build)..."
docker compose -f docker-compose.yml "${EXTRAS[@]}" up -d --no-build

echo ">> Done. Running containers:"
docker compose -f docker-compose.yml "${EXTRAS[@]}" ps
