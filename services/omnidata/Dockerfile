FROM node:22-slim

WORKDIR /app

# Optionally install Chromium for the keyless SERP scrape fallback.
# Build with: docker build --build-arg INSTALL_CHROMIUM=true .
ARG INSTALL_CHROMIUM=false

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Installs prod deps + optionalDependencies (@duckdb/node-api). Optional native
# builds that fail are skipped, so the image still builds without DuckDB.
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript tsx && npm run build && npm prune --omit=dev

RUN if [ "$INSTALL_CHROMIUM" = "true" ]; then \
      npx playwright install --with-deps chromium; \
    fi

# Persistent data dir for the Common Crawl webgraph DuckDB index.
RUN mkdir -p /data
ENV WEBGRAPH_DB_PATH=/data/webgraph.duckdb
VOLUME ["/data"]

ENV PORT=8787
EXPOSE 8787

CMD ["node", "dist/index.js"]
