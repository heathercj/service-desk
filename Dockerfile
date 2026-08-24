# syntax=docker/dockerfile:1.9
FROM node:22.17.0-bookworm-slim AS base
# The corepack bundled with the Node base image carries npm's older signing
# keys, so verifying the pnpm tarball fails with "Cannot find matching keyid"
# and the install below dies before it starts. Installing a current corepack
# brings the current keys with it; it is pinned for the same reason
# everything else here is, and is worth re-testing whenever the base tag
# moves -- a new enough Node makes this line unnecessary.
RUN npm install -g corepack@0.35.0 && corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
# `next build` collects page data by executing the route modules, and
# src/lib/env.ts validates the environment as soon as one of them is
# imported, so the build needs values for the three required keys or it dies
# on /_not-found. They are deliberately non-functional -- nothing in a build
# connects to a database or signs a token -- and they mirror what ci.yml
# sets for the same reason.
#
# Set on the RUN rather than as ENV so they exist for the length of this one
# command and never become image metadata: BuildKit's SecretsUsedInArgOrEnv
# check is right to warn about an `ENV AUTH_SECRET`, placeholder or not.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
    AUTH_SECRET="build-time-placeholder-not-a-real-secret-0000000000" \
    ENTRA_TENANT_ID="11111111-1111-1111-1111-111111111111" \
    ENABLE_DEV_AUTH="false" \
    pnpm build

# Deliberately not `FROM base`: base carries the package manager the build
# stages need, and the runtime does not need one. It only ever runs
# `node server.js`.
FROM node:22.17.0-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

# Two things, both because this is the only stage that ships.
#
# apt-get upgrade picks up the Debian security patches released since the
# base tag was cut. Without it the image inherits whatever was current when
# the tag was published, which by now is a dozen fixable HIGH CVEs in gpgv,
# libgnutls30, libpam-modules and friends.
#
# Removing npm and corepack clears every remaining node-pkg finding at once:
# tar, minimatch, glob, brace-expansion, ip-address and sigstore are all
# vendored inside them, and none of it is reachable from a running app.
RUN apt-get update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm \
            /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm \
            /usr/local/bin/npx \
            /usr/local/bin/corepack

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
