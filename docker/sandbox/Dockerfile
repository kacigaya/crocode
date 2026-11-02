# syntax=docker/dockerfile:1
FROM debian:bookworm-slim AS bubblewrap
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc libc6-dev meson ninja-build pkg-config libcap-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://codeload.github.com/containers/bubblewrap/tar.gz/refs/tags/v0.12.0 -o /tmp/bubblewrap.tar.gz \
    && echo '3f66d9e3f85396f6d7d7fbd2859f277e4fd3a9303341bfe2ff325251bda65fd4  /tmp/bubblewrap.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/bubblewrap.tar.gz -C /tmp
WORKDIR /tmp/bubblewrap-0.12.0
# gVisor already assigns loopback addresses. Replace is idempotent and keeps
# all other netlink failures fatal. Namespace isolation is unchanged.
RUN python3 -c 'from pathlib import Path; p=Path("network.c"); s=p.read_text(); old="NLM_F_CREATE | NLM_F_EXCL | NLM_F_ACK"; assert s.count(old)==1; p.write_text(s.replace(old,"NLM_F_CREATE | NLM_F_REPLACE | NLM_F_ACK"))' \
    && meson setup build -Dman=disabled -Dselinux=disabled -Dbash_completion=disabled -Dzsh_completion=disabled \
    && meson compile -C build \
    && meson test -C build --print-errorlogs

FROM node:24-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.316
ARG CODEX_VERSION=0.166.0
ARG OPENCODE_VERSION=1.19.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep ca-certificates libcap2 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
        "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    && groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid agent --create-home agent

COPY --from=bubblewrap /tmp/bubblewrap-0.12.0/build/bwrap /usr/local/bin/bwrap

# Installation tools are not needed in read-only review jobs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV HOME=/home/agent \
    DISABLE_AUTOUPDATER=1
USER 10001:10001
WORKDIR /repo
CMD ["claude", "--version"]
