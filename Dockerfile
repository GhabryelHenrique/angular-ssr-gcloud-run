# =============================================================================
# Angular SSR no Cloud Run — build multi-stage (slides 18 e 19)
#
# Node 22, não 20: o Angular 22 removeu o suporte ao Node 20. O @angular/core
# declara engines "^22.22.3 || ^24.15.0 || >=26.0.0" — em node:20-alpine o
# build falha na instalação.
# =============================================================================

# --- Estágio 1: build ---------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Copiar o manifesto ANTES do código é o truque de cache do slide 18: enquanto
# package*.json não mudar, o Docker reaproveita a camada do npm ci e o build de
# CI cai de minutos para segundos.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Estágio 2: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime

# Rodar como usuário sem privilégios. A imagem node já traz o usuário "node".
USER node
WORKDIR /app

ENV NODE_ENV=production

# Só o dist entra na imagem final.
#
# Repare no que NÃO está aqui: node_modules. O builder do Angular empacota as
# dependências de runtime — Express incluso — dentro do server.mjs, então a
# imagem final não precisa de um único pacote instalado. Menos bytes para
# baixar é instância pronta mais rápido, que é o estágio 1 do cold start.
COPY --from=build --chown=node:node /app/dist ./dist

# Documental: quem manda de verdade é a variável PORT injetada pelo Cloud Run.
EXPOSE 8080

CMD ["node", "dist/poc-cloud-run/server/server.mjs"]
