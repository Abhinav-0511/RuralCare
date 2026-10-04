# Build context: repo root (so /shared is available). See infra/docker-compose.yml.
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w @ruralcare/server -w @ruralcare/shared
COPY shared shared
COPY server server
RUN npm run build -w @ruralcare/server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w @ruralcare/server --omit=dev && npm cache clean --force
# @ruralcare/shared is bundled into dist by tsup, so only the build output is needed
COPY --from=build /repo/server/dist server/dist
USER node
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
