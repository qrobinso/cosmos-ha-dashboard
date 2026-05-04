ARG BUILD_FROM
# --- builder stage ---
FROM node:20-alpine AS builder

# Native deps for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /build
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY display/package.json display/
RUN npm ci

# Copy sources and build both packages
COPY server ./server
COPY display ./display
RUN npm run build

# Prune devDependencies for the runtime image
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

# Add-on entrypoint
COPY addon/run.sh /run.sh
RUN chmod a+x /run.sh

ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0 \
    DB_PATH=/data/cosmos.db \
    STATIC_DIR=/app/display/build

# Mount points provided by Supervisor:
#   /data — persistent state (SQLite goes here)
#   /addon_config — write-once add-on config (unused by Cosmos)
VOLUME ["/data"]

EXPOSE 8099

CMD ["/run.sh"]
