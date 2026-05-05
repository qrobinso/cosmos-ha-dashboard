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

# Manual MQTT override. If the user filled in mqtt_host in the addon
# Configuration tab, build an MQTT_URL from those fields and skip the
# Supervisor auto-discovery path. Empty mqtt_host = stay auto.
MQTT_HOST="$(bashio::config 'mqtt_host')"
if bashio::var.has_value "${MQTT_HOST}"; then
  MQTT_PORT="$(bashio::config 'mqtt_port')"
  MQTT_USER="$(bashio::config 'mqtt_username')"
  MQTT_PASS="$(bashio::config 'mqtt_password')"
  MQTT_SCHEME="mqtt"
  if bashio::config.true 'mqtt_use_ssl'; then
    MQTT_SCHEME="mqtts"
  fi
  if bashio::var.has_value "${MQTT_USER}"; then
    # URL-encode just the @ : / characters that would break parsing.
    ENC_USER="${MQTT_USER//@/%40}"; ENC_USER="${ENC_USER//:/%3A}"; ENC_USER="${ENC_USER//\//%2F}"
    ENC_PASS="${MQTT_PASS//@/%40}"; ENC_PASS="${ENC_PASS//:/%3A}"; ENC_PASS="${ENC_PASS//\//%2F}"
    export MQTT_URL="${MQTT_SCHEME}://${ENC_USER}:${ENC_PASS}@${MQTT_HOST}:${MQTT_PORT}"
  else
    export MQTT_URL="${MQTT_SCHEME}://${MQTT_HOST}:${MQTT_PORT}"
  fi
  bashio::log.info "using manual MQTT broker at ${MQTT_HOST}:${MQTT_PORT}"
fi

# Forward log level to NODE_DEBUG when relevant. Cosmos uses console.log/error today;
# log_level is wired through here for future structured logging.
case "${LOG_LEVEL}" in
  trace|debug) export NODE_DEBUG="cosmos*" ;;
  *) ;;
esac

cd /app
exec node server/dist/index.js
