#!/usr/bin/env bash
# Local Docker-based OWASP ZAP baseline scan (Section 16, `pnpm security:dast`).
# Assumes the app is already running locally (e.g. `pnpm dev` or the
# Docker Compose stack) and reachable at APP_BASE_URL. Baseline/passive
# scanning only -- never point this at a production deployment.
set -euo pipefail

BASE_URL="${APP_BASE_URL:-http://localhost:3000}"
REPORT_DIR="${PWD}/security-reports"
mkdir -p "${REPORT_DIR}"

# `--network host` only reaches the host's localhost on Linux. On Docker
# Desktop (Windows and macOS) the container runs inside a VM, so the same
# flag makes the scan silently find nothing at all -- host.docker.internal is
# how a container addresses its host there, and Desktop resolves it for free.
NETWORK_ARGS=(--network host)
if [ "$(uname -s)" != "Linux" ]; then
  NETWORK_ARGS=()
  BASE_URL="${BASE_URL//localhost/host.docker.internal}"
  BASE_URL="${BASE_URL//127.0.0.1/host.docker.internal}"
fi
TARGET_URL="${BASE_URL}/login"

echo "Running ZAP baseline against ${TARGET_URL} ..."

# Git Bash rewrites anything that looks like a Unix path in an argument into a
# Windows one, which mangles the container-side half of every -v mount.
export MSYS_NO_PATHCONV=1

# The +"..." guard is what makes an empty NETWORK_ARGS legal under `set -u`
# on bash 3.2, which is still what a stock macOS ships.
docker run --rm \
  ${NETWORK_ARGS[@]+"${NETWORK_ARGS[@]}"} \
  -v "${REPORT_DIR}:/zap/wrk/:rw" \
  -v "${PWD}/zap/rules.tsv:/zap/rules.tsv:ro" \
  zaproxy/zap-stable:2.15.0 \
  zap-baseline.py \
  -t "${TARGET_URL}" \
  -r zap-baseline-report.html \
  -w zap-baseline-report.md \
  -J zap-baseline-report.json \
  -c /zap/rules.tsv \
  -a

echo "Reports written to ${REPORT_DIR}"
