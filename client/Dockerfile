# Build from the REPO ROOT so /shared is in the build context:
#   docker build -f client/Dockerfile --build-arg VITE_SERVER_URL=https://your-server -t p2p-client .
FROM node:20-alpine AS build
WORKDIR /app
COPY client/package.json client/package-lock.json client/
RUN npm --prefix client ci
COPY shared shared
COPY client client
ARG VITE_SERVER_URL=http://localhost:4000
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm --prefix client run build

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
