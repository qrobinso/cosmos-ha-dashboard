ARG BUILD_FROM
# Branch / tag / commit of cosmos-ha-dashboard to bake into the image.
# Override per-version via addon/build.yaml `args:`.
ARG BUILD_REF=main

# --- builder stage ---
FROM node:20-alpine AS builder

# Native deps for better-sqlite3, plus git so we can fetch source.
RUN apk add --no-cache python3 make g++ git

# HA Supervisor pins the Docker build context to this `addon/` directory,
# but the actual app source lives at the repo root. Clone a fresh copy of
# the requested ref into /build instead of relying on COPY.
ARG BUILD_REF
RUN git clone --depth 1 --branch ${BUILD_REF} \
    https://github.com/qrobinso/cosmos-ha-dashboard.git /build

WORKDIR /build
RUN npm ci
RUN npm run build
RUN npm prune --workspace server --omit=dev

# --- runtime stage ---
FROM ${BUILD_FROM}

# Install Node 20 for the runtime
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Server runtime
COPY --from=builder /build/server/package.json /app/server/package.json
COPY --from=builder /build/server/dist /app/server/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/server/node_modules /app/server/node_modules

# Display static build
COPY --from=builder /build/display/build /app/display/build

# App entrypoint (lives next to this Dockerfile in addon/)
COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DB_PATH=/data/cosmos.db \
    STATIC_DIR=/app/display/build

# Mount points provided by Supervisor:
#   /data — persistent state (SQLite goes here)
#   /addon_config — write-once app config (unused by Cosmos)
VOLUME ["/data"]

EXPOSE 8099

CMD ["/run.sh"]
