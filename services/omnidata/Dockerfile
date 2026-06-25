FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript tsx && npm run build

ENV PORT=8787
EXPOSE 8787

CMD ["node", "dist/index.js"]
