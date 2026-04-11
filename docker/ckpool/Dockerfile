# ─────────────────────────────────────────────
# Stage 1: Build CKPool from source
# ─────────────────────────────────────────────
FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    git \
    build-base \
    autoconf \
    automake \
    libtool \
    jansson-dev \
    curl-dev \
    pkgconf \
    linux-headers

WORKDIR /build

# Clone CKPool source (Con Kolivas, official repo)
RUN git clone --depth=1 https://bitbucket.org/ckolivas/ckpool.git .

# Build
RUN autoreconf -fi && \
    ./configure --prefix=/usr/local && \
    make -j$(nproc) && \
    make install

# ─────────────────────────────────────────────
# Stage 2: Minimal runtime image
# ─────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache \
    jansson \
    libcurl \
    bash \
    gettext

# Copy compiled binary
COPY --from=builder /usr/local/bin/ckpool /usr/local/bin/ckpool

# Create directories
RUN mkdir -p /ckpool/logs /ckpool/config

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Stratum port
EXPOSE 3333

ENTRYPOINT ["/entrypoint.sh"]
