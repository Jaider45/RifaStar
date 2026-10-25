FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- Todas las dependencias (migraciones, seed, tests) ---
FROM base AS dev
# argon2 compila su módulo nativo cuando no hay binario precompilado para esta versión de Node.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

# --- Build y dependencias de producción ---
FROM dev AS build
RUN npx nest build && npm prune --omit=dev

# --- Imagen de ejecución (api y worker) ---
FROM base
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
