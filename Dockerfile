# One image for all three services (web, api, worker). Railway picks the
# start command per service (see infra/railway/*.json).
FROM node:22.12-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g npm@11.21.1
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM node:22.12-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Services start with plain `node` (see infra/railway/*.json), never npm/npx.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
USER node
# Overridden per service.
CMD ["node", "apps/api/dist/main.js"]
