# PocketBase with Voya hooks + migrations (amd64 + arm64 for Synology).
FROM alpine:3.20

ARG PB_VERSION=0.25.9
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip curl \
  && ARCH="${TARGETARCH:-amd64}" \
  && if [ "$ARCH" = "amd64" ] || [ "$ARCH" = "x86_64" ]; then PB_ARCH=amd64; \
     elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then PB_ARCH=arm64; \
     else echo "unsupported arch: $ARCH" && exit 1; fi \
  && curl -fsSL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" \
  && unzip /tmp/pb.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/pocketbase \
  && rm /tmp/pb.zip \
  && apk del unzip curl

WORKDIR /pb
COPY pb_hooks /pb/pb_hooks
COPY pb_migrations /pb/pb_migrations

EXPOSE 8090
VOLUME ["/pb/pb_data"]

CMD ["pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations"]
