FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential autoconf automake libtool \
    libjansson-dev libcurl4-openssl-dev pkg-config \
    ca-certificates libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth=1 https://bitbucket.org/ckolivas/ckpool.git .
RUN autoreconf -fi && ./configure --prefix=/usr/local && make -j$(nproc)

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libjansson4 libcurl4 bash gettext-base curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/src/ckpool /usr/local/bin/ckpool
RUN mkdir -p /ckpool/logs /ckpool/config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3333
ENTRYPOINT ["/entrypoint.sh"]
