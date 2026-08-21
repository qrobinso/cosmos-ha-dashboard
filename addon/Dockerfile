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
# No ffmpeg anywhere: the widget uses a video-only H.264 MP4 (the kiosk is
# muted, audio comes from the HA speaker), so nothing ever needs remuxing.
#
# UNPINNED BY DEFAULT, deliberately. A pinned yt-dlp goes stale, and a stale
# yt-dlp is how this feature breaks: YouTube changes, extractors stop working,
# and users see an empty widget or "403" in the log. That is not theoretical —
# it is exactly what happened between 0.7.x and 0.8.2.
#
# The ADD below is what makes "latest" actually mean latest. Docker hashes the
# response body, so a new yt-dlp release changes the hash and this layer
# rebuilds; with no new release the layer stays cached and the build is fast.
# Without it, `pip install --upgrade` would sit behind a cached layer and ship
# whatever was current the day the layer was first built — the same staleness,
# just harder to see.
#
# GitHub's release endpoint rather than PyPI's JSON: same information for this
# purpose, 60 KB instead of 1.2 MB, and the same host the builder stage already
# depends on. Only its CONTENT HASH matters here — the tag it carries
# (2026.08.19) is not the PyPI version string (2026.8.19), and nothing reads it.
ADD https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest /tmp/.ytdlp-release

# Set to a version (e.g. 2026.8.19) to pin instead — the escape hatch for a
# broken upstream release. Empty means "install the newest".
ARG YTDLP_VERSION=
RUN set -eu; \
    apk add --no-cache python3 py3-pip; \
    if [ -n "${YTDLP_VERSION}" ]; then SPEC="yt-dlp==${YTDLP_VERSION}"; else SPEC="yt-dlp"; fi; \
    # PEP 668 marks Alpine's Python "externally managed" on newer releases.
    # The flag is what we want there; older pip rejects the flag outright, so
    # fall back to a plain install.
    pip3 install --no-cache-dir --upgrade --break-system-packages "${SPEC}" \
      || pip3 install --no-cache-dir --upgrade "${SPEC}"; \
    # Fail the build loudly rather than shipping an image whose video backdrop
    # is silently dead. This is what caught the musl failure in 0.7.0.
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
