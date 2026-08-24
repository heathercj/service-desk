# syntax=docker/dockerfile:1.9
FROM node:22.12-bookworm-slim AS base
# The corepack bundled with node:22.12 carries npm's older signing keys, so
# verifying the pnpm tarball fails with "Cannot find matching keyid" and the
# install below dies before it starts. Installing a current corepack brings
# the current keys with it; it is pinned for the same reason everything else
# here is, and updating Node's base tag is the thing that retires this line.
RUN npm install -g corepack@0.35.0 && corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/api/health',res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
