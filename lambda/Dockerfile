# =============================================================================
# Imagem de container para AWS Lambda.
#
# Compare com o Dockerfile da raiz. Aqui a imagem base NÃO é o node:22-alpine
# oficial: é a base da AWS, que embute o Runtime Interface Client. O container
# não escuta numa porta — ele fala o protocolo de invocação do Lambda.
#
# Build a partir da RAIZ do projeto:
#   docker build -f lambda/Dockerfile -t angular-ssr-lambda:local .
# =============================================================================

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Configuração de build separada: o ssr.entry aponta para lambda/server.lambda.ts
# em vez de src/server.ts. Duas saídas para a mesma aplicação.
RUN npm run build:lambda

# -----------------------------------------------------------------------------
FROM public.ecr.aws/lambda/nodejs:22

# O LAMBDA_TASK_ROOT é /var/task — a base da AWS espera o código exatamente ali.
WORKDIR ${LAMBDA_TASK_ROOT}

COPY --from=build /app/dist ./dist
COPY lambda/handler.mjs ./handler.mjs

# Sem CMD ["node", ...]: o formato aqui é "arquivo.exportação". Quem inicia o
# processo é o runtime da AWS, não você.
CMD ["handler.handler"]
