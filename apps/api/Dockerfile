# Build context: repo root (run: docker build -f apps/api/Dockerfile .)
#
# Stage 1: Install ALL dependencies (dev included, needed for build)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/validation/package.json ./packages/validation/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN npm ci --workspace=apps/api --workspace=packages/validation --workspace=packages/typescript-config --include-workspace-root

# Stage 2: Compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY packages/typescript-config/ ./packages/typescript-config/
COPY packages/validation/src/ ./packages/validation/src/
COPY packages/validation/tsconfig.json ./packages/validation/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./apps/api/
RUN npm run build --workspace=packages/validation
RUN npm run build --workspace=apps/api

# Stage 3: Production-only dependencies (clean install, no dev deps)
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/validation/package.json ./packages/validation/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN npm ci --omit=dev --workspace=apps/api --workspace=packages/validation --workspace=packages/typescript-config --include-workspace-root

# Stage 4: Minimal production image
FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S frapp && adduser -S frapp -G frapp

COPY --from=prod-deps --chown=frapp:frapp /app/node_modules/ ./node_modules/
COPY --from=prod-deps --chown=frapp:frapp /app/apps/api/node_modules/ ./apps/api/node_modules/
COPY --from=prod-deps --chown=frapp:frapp /app/package.json ./
COPY --from=builder --chown=frapp:frapp /app/apps/api/dist/ ./apps/api/dist/
COPY --from=builder --chown=frapp:frapp /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=frapp:frapp /app/packages/validation/dist/ ./packages/validation/dist/
COPY --from=builder --chown=frapp:frapp /app/packages/validation/package.json ./packages/validation/

USER frapp
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]
