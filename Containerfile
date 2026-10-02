# Build: podman build -t my-project -f Containerfile .   (or docker build -f Containerfile .)
# Run:   podman run --env-file .env.production -p 3001:3001 my-project
#
# Both stages use the same Alpine (musl) base: argon2 ships a prebuilt
# linux-x64/arm64 musl binary, so `npm ci` in the runtime stage picks the one
# matching this libc and nothing has to be compiled (no python/g++ needed).

# ---------- build ----------
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

# APP_HOST=0.0.0.0: inside a container the app must listen on all interfaces
# (the app default, 127.0.0.1, is for running directly on a host).
ENV NODE_ENV=production \
    UV_THREADPOOL_SIZE=8 \
    APP_HOST=0.0.0.0 \
    PORT=3001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY scripts ./scripts

USER node
EXPOSE 3001

# Migrations are not run here: run `npm run migration:run` from a checkout
# (or a one-off job) before rolling out a version that needs them.
CMD ["node", "scripts/cluster.mjs"]
