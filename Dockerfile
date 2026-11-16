# syntax=docker/dockerfile:1.10
#
# ZimaForge – ein statisches Rust-Binary in einem leeren Image (scratch).
# Gebaut wird nativ je Architektur (amd64/arm64 auf eigenen Runnern),
# daher kein QEMU und keine Cross-Toolchain nötig.

# "1" = jeweils aktuelles stabiles Rust (Edition 2024, let-chains ab 1.88).
ARG RUST_VERSION=1

FROM rust:${RUST_VERSION}-alpine AS build
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock rustfmt.toml ./
COPY src ./src
COPY runtime ./runtime
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked \
 && cp target/release/zimaforge /zimaforge \
 && /zimaforge --version

# Leeres Datenverzeichnis mit passenden Rechten für den Fall ohne Bind-Mount.
RUN mkdir -p /out/data

FROM scratch
ARG VERSION=dev
LABEL org.opencontainers.image.title="ZimaForge" \
      org.opencontainers.image.description="Mod framework for the ZimaOS dashboard" \
      org.opencontainers.image.source="https://github.com/MarcelRuh/zimaforge" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

COPY --from=build /zimaforge /zimaforge
COPY --from=build /out/data /data
COPY mods /opt/zimaforge/catalog

ENV ZIMAFORGE_PORT=8077 \
    ZIMAFORGE_UPSTREAM=http://127.0.0.1:80 \
    ZIMAFORGE_DATA=/data \
    ZIMAFORGE_CATALOG=/opt/zimaforge/catalog \
    ZIMAFORGE_PROC=/host/proc \
    ZIMAFORGE_SYS=/host/sys

EXPOSE 8077
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/zimaforge", "healthcheck"]
ENTRYPOINT ["/zimaforge"]
