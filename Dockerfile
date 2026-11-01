# syntax=docker/dockerfile:1
FROM rust:1.97.1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY migrations ./migrations
RUN cargo build --locked --release --bin crocode

FROM docker:29-cli AS docker-cli

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10000 crocode \
    && useradd --uid 10000 --gid crocode --create-home crocode \
    && install -d -o crocode -g crocode /var/lib/crocode/work
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /src/target/release/crocode /usr/local/bin/crocode
USER 10000:10000
ENV CROCODE_WORK_DIR=/var/lib/crocode/work
EXPOSE 8080
ENTRYPOINT ["crocode"]
CMD ["all"]
