# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# --- dependencias (capa cacheable: solo se reinstala si cambia package*.json)
FROM base AS deps
COPY package*.json ./
RUN npm ci

# --- desarrollo: Vite con recarga en vivo (el código se monta en
# docker-compose.override.yml). Se selecciona con target: dev.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# --- build de producción: genera el sitio estático en /app/dist
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- producción: Caddy sirve el sitio estático, reenvía /api a la API y obtiene
# y renueva el certificado HTTPS automáticamente (Let's Encrypt) para el dominio
# configurado. Se selecciona con target: prod (ver docker-compose.prod.yml).
FROM caddy:2-alpine AS prod
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
