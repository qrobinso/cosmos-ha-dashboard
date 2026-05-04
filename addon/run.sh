#!/usr/bin/with-contenv bashio
set -e

# bashio is provided by ghcr.io/hassio-addons/base — exposes config, log, etc.
LOG_LEVEL="$(bashio::config 'log_level')"
bashio::log.info "starting Cosmos (log level: ${LOG_LEVEL})"

# Pass the Supervisor-injected env vars through to the Node process.
# - SUPERVISOR_TOKEN is auto-injected by Supervisor when hassio_api is true.
# - The Node process detects it and falls back to http://supervisor/core for HA + queries
#   /services/mqtt for the broker.
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
export DB_PATH="${DB_PATH:-/data/cosmos.db}"
export STATIC_DIR="${STATIC_DIR:-/app/display/build}"
export PORT="${PORT:-8099}"
export HOST="${HOST:-0.0.0.0}"

# Forward log level to NODE_DEBUG when relevant. Cosmos uses console.log/error today;
# log_level is wired through here for future structured logging.
case "${LOG_LEVEL}" in
  trace|debug) export NODE_DEBUG="cosmos*" ;;
  *) ;;
esac

cd /app
exec node server/dist/index.js
