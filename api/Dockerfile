# Build from repo root: docker compose build api
FROM node:22-alpine AS agent-build
WORKDIR /agent
# better-sqlite3 needs a toolchain on Alpine (musl); kept only for the build stage.
RUN apk add --no-cache python3 make g++
COPY agent/package.json agent/package-lock.json* ./
RUN npm install
COPY agent/tsconfig.json ./
COPY agent/src ./src
COPY agent/config ./config
RUN cp -n config/user.example.json config/user.json
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY agent/package.json /agent/package.json
COPY --from=agent-build /agent/dist /agent/dist
COPY --from=agent-build /agent/node_modules /agent/node_modules
COPY --from=agent-build /agent/config /agent/config
COPY api/package.json api/package-lock.json* ./
RUN npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /agent /agent
COPY api/package.json api/tsconfig.json ./
COPY api/src ./src
# Agent is already compiled in agent-build; skip api prebuild (needs agent src/tsconfig).
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY api/package.json api/package-lock.json* ./
COPY --from=deps /agent /agent
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
