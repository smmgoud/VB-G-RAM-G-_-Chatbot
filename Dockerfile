# Docker deployment for Node.js + Playwright Chromium
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first for better build caching.
COPY package*.json ./
RUN npm install --omit=dev \
 && npx playwright install --with-deps chromium

COPY . .

# Cloud hosts provide PORT dynamically.
EXPOSE 8080
CMD ["npm", "start"]
