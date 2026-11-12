# Build static assets (Vite inlines VITE_* at build time).
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_POCKETBASE_URL
ARG VITE_APP_BUILD
ARG BUILD_NUMBER

ENV VITE_POCKETBASE_URL=${VITE_POCKETBASE_URL}
ENV VITE_APP_BUILD=${VITE_APP_BUILD}
ENV BUILD_NUMBER=${BUILD_NUMBER}

# When deploy/.env.production exists on the build host, copy it so Vite sees `.env.production`.
# Empty ARG/ENV would block file values — unset empty vars first. Non-empty build-args still win.
RUN if [ -f deploy/.env.production ]; then cp deploy/.env.production .env.production; fi \
  && bash -c '\
    [ -z "${VITE_POCKETBASE_URL:+x}" ] && unset VITE_POCKETBASE_URL || true; \
    [ -z "${VITE_APP_BUILD:+x}" ] && unset VITE_APP_BUILD || true; \
    if [ -z "${BUILD_NUMBER:+x}" ]; then export BUILD_NUMBER="$(date -u +%Y%m%d%H%M%S)"; fi; \
    exec npm run build' \
  && rm -f .env.production

FROM nginx:1.27-alpine
COPY deploy/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
