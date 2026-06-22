# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# --- dependencias (capa cacheable: solo se reinstala si cambia package*.json)
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# --- imagen final
FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER nodeapp
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"
CMD ["node", "src/server.js"]
