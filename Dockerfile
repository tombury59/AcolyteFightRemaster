# syntax=docker/dockerfile:1

# AcolyteFightRemaster — image unique : build le front, le sert, et fait
# tourner le relais multijoueur WebSocket dans le même process (un seul port).
# D'apres Acolyte Fight de Ray Hidayat. Usage non commercial uniquement.

# ---- Stage 1 : build du front (Vite) --------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# Deps front (legacy-peer-deps via .npmrc pour react-motion)
COPY .npmrc package.json package-lock.json* ./
RUN npm install

# Code + assets, puis build. "auto" => le client déduit l'URL ws de l'origine,
# donc l'image marche sur n'importe quel domaine sans rebuild.
COPY . .
ARG VITE_SERVER_URL=auto
RUN VITE_SERVER_URL=$VITE_SERVER_URL npm run build

# ---- Stage 2 : runtime (relais + statique) --------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

# Deps du serveur (tsx inclus pour l'exécution TS)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --include=dev

# Sources serveur + front buildé
COPY server ./server
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV STATIC_DIR=/app/dist
ENV PORT=7770
# Jeu 100% entre amis par defaut (aucun bot). Ajuste si besoin.
ENV MIN_BOTS=0
ENV MAX_BOTS=0

EXPOSE 7770
CMD ["npm", "--prefix", "server", "start"]
