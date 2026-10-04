# Build context: repo root (so /shared is available). See infra/docker-compose.yml.
# React PWA: build static assets, serve via nginx
# (a production build is required, because service workers are not active in the Vite dev server by default)
FROM node:24-alpine AS build
WORKDIR /repo
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci -w @ruralcare/client -w @ruralcare/shared
COPY shared shared
COPY client client
RUN npm run build -w @ruralcare/client

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/client/dist /usr/share/nginx/html
EXPOSE 80
