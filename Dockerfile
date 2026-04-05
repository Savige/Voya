# Build static assets (Vite inlines VITE_* at build time).
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAPS_MAP_ID
ARG VITE_APP_BUILD
ARG BUILD_NUMBER

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_GOOGLE_MAPS_API_KEY=${VITE_GOOGLE_MAPS_API_KEY}
ENV VITE_GOOGLE_MAPS_MAP_ID=${VITE_GOOGLE_MAPS_MAP_ID}
ENV VITE_APP_BUILD=${VITE_APP_BUILD}
ENV BUILD_NUMBER=${BUILD_NUMBER}

# When deploy/.env.production exists on the build host, copy it so Vite sees `.env.production` like local builds.
# Vite's loadEnv lets process.env override files for VITE_* — empty ARG/ENV would block file values, so unset empty vars first.
# Non-empty build-args from Compose still win. .env.production is removed after build.
RUN if [ -f deploy/.env.production ]; then cp deploy/.env.production .env.production; fi \
  && bash -c '\
    [ -z "${VITE_SUPABASE_URL:+x}" ] && unset VITE_SUPABASE_URL || true; \
    [ -z "${VITE_SUPABASE_ANON_KEY:+x}" ] && unset VITE_SUPABASE_ANON_KEY || true; \
    [ -z "${VITE_GOOGLE_MAPS_API_KEY:+x}" ] && unset VITE_GOOGLE_MAPS_API_KEY || true; \
    [ -z "${VITE_GOOGLE_MAPS_MAP_ID:+x}" ] && unset VITE_GOOGLE_MAPS_MAP_ID || true; \
    [ -z "${VITE_APP_BUILD:+x}" ] && unset VITE_APP_BUILD || true; \
    if [ -z "${BUILD_NUMBER:+x}" ]; then export BUILD_NUMBER="$(date -u +%Y%m%d%H%M%S)"; fi; \
    exec npm run build' \
  && rm -f .env.production

FROM nginx:1.27-alpine
COPY deploy/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
