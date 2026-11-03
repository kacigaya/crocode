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

# OpenGrep (LGPL-2.1) and opengrep-rules (LGPL-2.1 with the Commons Clause).
# Both are pinned by version and SHA-256. See docker/README.md for the license
# condition on the rules.
FROM debian:bookworm-slim AS opengrep
ARG TARGETARCH
ARG OPENGREP_VERSION=1.33.1
ARG OPENGREP_RULES_COMMIT=f1d2b562b414783763fd02a6ed2736eaed622efa
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
        arm64) asset=opengrep_manylinux_aarch64; sum=d1433f63a90b8bc0b6ad4b498a13b372b856ce9a754a43484ba4920fe2d76dcf ;; \
        amd64) asset=opengrep_manylinux_x86; sum=46e8133cc490f9f50518061590ce2f6be5a08afaeda034471c0ceda4b3899808 ;; \
        *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/opengrep "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/${asset}" \
    && echo "${sum}  /tmp/opengrep" | sha256sum -c - \
    && install -m 0755 /tmp/opengrep /usr/local/bin/opengrep
# Keep rule files only: no test fixtures, autofix samples, or tooling.
RUN curl -fsSL -o /tmp/rules.tar.gz "https://codeload.github.com/opengrep/opengrep-rules/tar.gz/${OPENGREP_RULES_COMMIT}" \
    && echo "9a5f1cd5c625418cc1c776120123e2d4371df9bb66e099426b17c3488e13619d  /tmp/rules.tar.gz" | sha256sum -c - \
    && mkdir -p /tmp/rules /opt/opengrep-rules \
    && tar -xzf /tmp/rules.tar.gz --strip-components=1 -C /tmp/rules \
    && cd /tmp/rules \
    && for dir in ai apex bash c clojure csharp dockerfile elixir generic go html java javascript json \
            kotlin libsonnet ocaml php python ruby rust scala solidity swift terraform typescript yaml; do \
        find "$dir" -type f \( -name '*.yaml' -o -name '*.yml' \) \
            ! -name '*.test.yaml' ! -name '*.test.yml' ! -name '*.fixed.*' \
            -exec cp --parents {} /opt/opengrep-rules/ \; ; \
    done \
    && cp LICENSE /opt/opengrep-rules/LICENSE

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
COPY --from=opengrep /usr/local/bin/opengrep /usr/local/bin/opengrep
COPY --from=opengrep /opt/opengrep-rules /opt/opengrep-rules
# OpenGrep is a Nuitka onefile binary that unpacks itself on first run. Unpack
# it now into the image, so scans need no writable, executable directory.
# The worker sets XDG_CACHE_HOME to this path for scan jobs only.
RUN XDG_CACHE_HOME=/opt/opengrep-cache opengrep --version \
    && chmod -R a+rX /opt/opengrep-cache /opt/opengrep-rules

# Installation tools are not needed in read-only review jobs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV HOME=/home/agent \
    DISABLE_AUTOUPDATER=1
USER 10001:10001
WORKDIR /repo
CMD ["claude", "--version"]
