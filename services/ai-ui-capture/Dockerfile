# Playwright image ships Chromium + system deps, so captures work out of the box.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript tsx && npm run build && npm prune --omit=dev

ENV PORT=8788
EXPOSE 8788

CMD ["node", "dist/index.js"]
