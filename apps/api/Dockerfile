# Build context: repo root (run: docker build -f apps/api/Dockerfile .)
#
# Stage 1: Install ALL dependencies (dev included, needed for build)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/validation/package.json ./packages/validation/
COPY packages/org-archetypes/package.json ./packages/org-archetypes/
COPY packages/chapter-theme/package.json ./packages/chapter-theme/
COPY packages/color/package.json ./packages/color/
COPY packages/formatting/package.json ./packages/formatting/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN npm ci --workspace=apps/api --workspace=packages/validation --workspace=packages/org-archetypes --workspace=packages/chapter-theme --workspace=packages/color --workspace=packages/formatting --workspace=packages/typescript-config --include-workspace-root

# Stage 2: Compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY packages/typescript-config/ ./packages/typescript-config/
COPY packages/validation/src/ ./packages/validation/src/
COPY packages/validation/tsconfig.json ./packages/validation/
COPY packages/org-archetypes/src/ ./packages/org-archetypes/src/
COPY packages/org-archetypes/tsconfig.json ./packages/org-archetypes/
COPY packages/chapter-theme/src/ ./packages/chapter-theme/src/
COPY packages/chapter-theme/tsconfig.json ./packages/chapter-theme/
COPY packages/color/src/ ./packages/color/src/
COPY packages/color/tsconfig.json ./packages/color/
COPY packages/formatting/src/ ./packages/formatting/src/
COPY packages/formatting/tsconfig.json ./packages/formatting/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./apps/api/
RUN npm run build --workspace=packages/validation
RUN npm run build --workspace=packages/org-archetypes
# Before chapter-theme, which imports @repo/color and resolves it through dist.
# Separate RUN lines, not one --workspace list: npm gives no ordering guarantee
# across workspaces, so a combined invocation can compile chapter-theme first
# and fail on a dist that does not exist yet.
RUN npm run build --workspace=packages/color
RUN npm run build --workspace=packages/chapter-theme
# @repo/formatting has no @repo dependencies, so it only has to precede apps/api.
RUN npm run build --workspace=packages/formatting
RUN npm run build --workspace=apps/api

# Stage 3: Production-only dependencies (clean install, no dev deps)
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/validation/package.json ./packages/validation/
COPY packages/org-archetypes/package.json ./packages/org-archetypes/
COPY packages/chapter-theme/package.json ./packages/chapter-theme/
COPY packages/color/package.json ./packages/color/
COPY packages/formatting/package.json ./packages/formatting/
COPY packages/typescript-config/package.json ./packages/typescript-config/
# mkdir guards the runner-stage COPYs. Hoisting decides where every dependency
# lands, and BOTH directions break a COPY that assumes the other:
#   - hoisted to the root  -> apps/api/node_modules is never created
#   - forced down by a version conflict -> packages/<name>/node_modules appears
# The second direction is what broke staging for four days (#1160): `colorjs.io`
# moved to packages/chapter-theme/node_modules and `zod` to
# packages/validation/node_modules, neither of which the runner copied, so the
# image built cleanly and then died on its first require(). Every tree the
# runner stage copies is created here so no COPY can fail with "not found".
RUN npm ci --omit=dev --workspace=apps/api --workspace=packages/validation --workspace=packages/org-archetypes --workspace=packages/chapter-theme --workspace=packages/color --workspace=packages/formatting --workspace=packages/typescript-config --include-workspace-root \
    && mkdir -p apps/api/node_modules \
       packages/validation/node_modules \
       packages/org-archetypes/node_modules \
       packages/chapter-theme/node_modules \
       packages/color/node_modules \
       packages/formatting/node_modules

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
COPY --from=prod-deps --chown=frapp:frapp /app/packages/validation/node_modules/ ./packages/validation/node_modules/
COPY --from=builder --chown=frapp:frapp /app/packages/org-archetypes/dist/ ./packages/org-archetypes/dist/
COPY --from=builder --chown=frapp:frapp /app/packages/org-archetypes/package.json ./packages/org-archetypes/
COPY --from=prod-deps --chown=frapp:frapp /app/packages/org-archetypes/node_modules/ ./packages/org-archetypes/node_modules/
COPY --from=builder --chown=frapp:frapp /app/packages/chapter-theme/dist/ ./packages/chapter-theme/dist/
COPY --from=builder --chown=frapp:frapp /app/packages/chapter-theme/package.json ./packages/chapter-theme/
COPY --from=prod-deps --chown=frapp:frapp /app/packages/chapter-theme/node_modules/ ./packages/chapter-theme/node_modules/
COPY --from=builder --chown=frapp:frapp /app/packages/color/dist/ ./packages/color/dist/
COPY --from=builder --chown=frapp:frapp /app/packages/color/package.json ./packages/color/
COPY --from=prod-deps --chown=frapp:frapp /app/packages/color/node_modules/ ./packages/color/node_modules/
COPY --from=builder --chown=frapp:frapp /app/packages/formatting/dist/ ./packages/formatting/dist/
COPY --from=builder --chown=frapp:frapp /app/packages/formatting/package.json ./packages/formatting/
COPY --from=prod-deps --chown=frapp:frapp /app/packages/formatting/node_modules/ ./packages/formatting/node_modules/

USER frapp
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]
