# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# --- dependencias (capa cacheable: solo se reinstala si cambia package*.json)
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- desarrollo: Vite con recarga en vivo (--host para que sea accesible
# desde fuera del contenedor). En docker-compose.override.yml se monta el
# código fuente encima para HMR. Para producción lo natural es un build
# estático servido por nginx; se deja fuera a propósito (ver README).
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
