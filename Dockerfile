# OmniPresence Engine - Next.js app image for Railway / any always-on host.
# Railway sets PORT; `next start` binds to it automatically.
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# --- build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next may not create public/; Docker COPY requires the path to exist.
RUN mkdir -p public
RUN npm run build

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
# Run as the unprivileged `node` user shipped in the base image (never root).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
# Needed for railway.json preDeployCommand (`npm run db:migrate`).
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/supabase ./supabase
USER node

EXPOSE 3000
# Railway provides PORT; `next start` binds to it. Healthcheck is configured in
# railway.json (/api/health). CMD stays the npm script for parity with local.
CMD ["npm", "run", "start"]
