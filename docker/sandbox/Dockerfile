# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.316
ARG CODEX_VERSION=0.166.0
ARG OPENCODE_VERSION=1.19.5

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global \
        "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
        "@openai/codex@${CODEX_VERSION}" \
        "opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force \
    && groupadd --gid 10001 agent \
    && useradd --uid 10001 --gid agent --create-home agent

# Installation tools are not needed in read-only review jobs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV HOME=/home/agent \
    DISABLE_AUTOUPDATER=1
USER 10001:10001
WORKDIR /repo
CMD ["claude", "--version"]
