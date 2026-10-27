# Build from repository root: docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --legacy-peer-deps
COPY src ./src
COPY server/src ./server/src
COPY server/tsconfig.json ./server/tsconfig.json
RUN cd server && npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=build /app/server/dist ./dist
EXPOSE 2567
CMD ["node", "dist/index.js"]
