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
#
# The `ADD <github-api-url>` line busts the BuildKit layer cache when the
# tip of BUILD_REF moves: Docker hashes the response body, so a new commit
# on main produces a different hash and the subsequent git clone re-runs.
ARG BUILD_REF
ADD https://api.github.com/repos/qrobinso/cosmos-ha-dashboard/commits/${BUILD_REF} /tmp/.git-ref
RUN git clone --depth 1 --branch ${BUILD_REF} \
    https://github.com/qrobinso/cosmos-ha-dashboard.git /build

WORKDIR /build
RUN npm ci
RUN npm run build
RUN npm prune --workspace server --omit=dev

# --- runtime stage ---
FROM ${BUILD_FROM}

# Install Node 20 for the runtime.
RUN apk add --no-cache nodejs npm ca-certificates

# yt-dlp for the musicvideo widget. Without it that widget can only ever
# report itself unavailable, so the feature would ship dead in this image.
#
# Installed from PyPI against the image's OWN Python. Two rejected alternatives,
# both for concrete reasons:
#
#   * yt-dlp's standalone musllinux binary was tried first and FAILS on this
#     base. It bundles Python 3.14, which needs the `pwritev2` symbol added in
#     musl 1.2.5 (Alpine 3.20); ghcr.io/hassio-addons/base:15.0.7 predates that,
#     so the binary aborts immediately with
#     "Error relocating libpython3.14.so.1.0: pwritev2: symbol not found".
#     Do not reintroduce it without first bumping the base image.
#
#   * `apk add yt-dlp` would link correctly but lags badly (Alpine v3.21 still
#     ships 2025.03.31), and a stale yt-dlp is precisely how this feature
#     breaks — YouTube changes, old extractors stop working.
#
# pip gives a current release linked against the right libc. Note the PyPI
# version format strips leading zeros (2026.7.4, NOT 2026.07.04).
#
# No ffmpeg anywhere: the widget pins `-f 18`, a progressive MP4 with muxed
# audio, so nothing ever needs remuxing.
ARG YTDLP_VERSION=2026.8.19
RUN set -eu; \
    apk add --no-cache python3 py3-pip; \
    # PEP 668 marks Alpine's Python "externally managed" on newer releases.
    # The flag is what we want there; older pip rejects the flag outright, so
    # fall back to a plain install.
    pip3 install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}" \
      || pip3 install --no-cache-dir "yt-dlp==${YTDLP_VERSION}"; \
    # Fail the build loudly rather than shipping an image whose music video
    # widget is silently dead. This is what caught the musl failure above.
    yt-dlp --version

WORKDIR /app

# Server runtime. npm workspaces hoists deps to the root node_modules,
# so a single copy is enough — Node's upward resolution finds them
# from /app/server/dist.
COPY --from=builder /build/server/package.json /app/server/package.json
COPY --from=builder /build/server/dist /app/server/dist
COPY --from=builder /build/node_modules /app/node_modules

# Display static build
COPY --from=builder /build/display/build /app/display/build

# Bundled docs — surfaced through the admin /docs page and the /api/docs
# endpoint. Must sit at /app/docs because the server resolves the repo root
# as two dirs above its compiled entrypoint at /app/server/dist/index.js.
COPY --from=builder /build/docs /app/docs

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
