#!/usr/bin/env bash
# Local Docker-based OWASP ZAP baseline scan (Section 16, `pnpm security:dast`).
# Assumes the app is already running locally (e.g. `pnpm dev` or the
# Docker Compose stack) and reachable at APP_BASE_URL. Baseline/passive
# scanning only -- never point this at a production deployment.
set -euo pipefail

TARGET_URL="${APP_BASE_URL:-http://localhost:3000}/login"
REPORT_DIR="$(pwd)/security-reports"
mkdir -p "${REPORT_DIR}"

echo "Running ZAP baseline against ${TARGET_URL} ..."

docker run --rm \
  --network host \
  -v "${REPORT_DIR}:/zap/wrk/:rw" \
  -v "$(pwd)/zap/rules.tsv:/zap/rules.tsv:ro" \
  zaproxy/zap-stable:2.15.0 \
  zap-baseline.py \
  -t "${TARGET_URL}" \
  -r zap-baseline-report.html \
  -w zap-baseline-report.md \
  -J zap-baseline-report.json \
  -c /zap/rules.tsv \
  -a

echo "Reports written to ${REPORT_DIR}"
