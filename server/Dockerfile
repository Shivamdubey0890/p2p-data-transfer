# Build from the REPO ROOT so /shared is in the build context:
#   docker build -f server/Dockerfile -t p2p-server .
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci
COPY shared shared
COPY server/tsconfig.json server/
COPY server/src server/src
RUN npm --prefix server run build

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist ./dist
EXPOSE 4000
USER node
CMD ["node", "dist/server/src/index.js"]
