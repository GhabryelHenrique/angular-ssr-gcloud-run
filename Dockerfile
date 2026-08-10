# =============================================================================
# Angular SSR on Cloud Run — multi-stage build
#
# Node 22, not 20: Angular 22 dropped Node 20 support. @angular/core declares
# engines "^22.22.3 || ^24.15.0 || >=26.0.0", so `npm ci` fails outright on
# node:20-alpine.
# =============================================================================

# --- Stage 1: build -----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copying the manifest before the source is the layer-caching trick: as long as
# package*.json is unchanged, Docker reuses the cached `npm ci` layer and CI
# builds drop from minutes to seconds.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Stage 2: runtime ---------------------------------------------------------
FROM node:22-alpine AS runtime

# Run unprivileged. The official node image already ships a `node` user.
USER node
WORKDIR /app

ENV NODE_ENV=production

# Only the build output goes into the final image.
#
# Note what is absent: node_modules. Angular's application builder bundles the
# runtime dependencies — Express included — into server.mjs, so the final image
# needs no installed packages at all. Fewer bytes to pull means an instance
# becomes ready sooner, which is the first stage of a cold start.
COPY --from=build --chown=node:node /app/dist ./dist

# Documentation only: the port that matters is the PORT variable Cloud Run
# injects at runtime.
EXPOSE 8080

CMD ["node", "dist/angular-ssr-cloud-run/server/server.mjs"]
