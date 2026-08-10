# =============================================================================
# Container image for AWS Lambda.
#
# Compare this with the Dockerfile at the repository root. The base image here
# is not the official node:22-alpine: it is the AWS base, which embeds the
# Runtime Interface Client. This container does not listen on a port — it
# speaks Lambda's invocation protocol.
#
# Build from the REPOSITORY ROOT:
#   docker build -f lambda/Dockerfile -t angular-ssr-lambda:local .
# =============================================================================

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# A separate build configuration: ssr.entry points at lambda/server.lambda.ts
# instead of src/server.ts. Two outputs for the same application.
RUN npm run build:lambda

# -----------------------------------------------------------------------------
FROM public.ecr.aws/lambda/nodejs:22

# LAMBDA_TASK_ROOT is /var/task — the AWS base expects the code exactly there.
WORKDIR ${LAMBDA_TASK_ROOT}

COPY --from=build /app/dist ./dist
COPY lambda/handler.mjs ./handler.mjs

# No CMD ["node", ...]: the format here is "file.export". The AWS runtime
# starts the process, not you.
CMD ["handler.handler"]
