# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1 — deps: install all workspace dependencies once.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Workspaces require the root package*.json plus each app's package.json so
# `npm ci` resolves the lockfile correctly.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/prisma ./apps/api/prisma

RUN npm ci --workspaces --include-workspace-root=false

# -----------------------------------------------------------------------------
# Stage 2 — build: compile TypeScript + generate Prisma client.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api

WORKDIR /app/apps/api
RUN npx prisma generate
RUN npx tsc

# -----------------------------------------------------------------------------
# Stage 3 — runtime: minimal image with only what's needed to run.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Non-root user (node user exists in the base image with uid 1000).
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api

EXPOSE 3001

# Apply outstanding migrations then start. Use `migrate deploy` (not `dev`)
# in production — it never alters the schema beyond what migrations declare.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
