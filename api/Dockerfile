# Build from repo root: docker compose build api
FROM node:22-alpine AS agent-build
# better-sqlite3 needs a toolchain on Alpine (musl); kept only for the build stage.
RUN apk add --no-cache python3 make g++
COPY db/package.json db/package-lock.json* /db/
RUN npm install --prefix /db
COPY db/tsconfig.json /db/
COPY db/src /db/src
RUN npm run build --prefix /db
WORKDIR /agent
COPY agent/package.json agent/package-lock.json* ./
RUN npm install
COPY agent/tsconfig.json ./
COPY agent/src ./src
COPY agent/config ./config
RUN cp -n config/user.example.json config/user.json
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY db/package.json /db/package.json
COPY --from=agent-build /db/dist /db/dist
COPY --from=agent-build /db/node_modules /db/node_modules
COPY agent/package.json /agent/package.json
COPY --from=agent-build /agent/dist /agent/dist
COPY --from=agent-build /agent/node_modules /agent/node_modules
COPY --from=agent-build /agent/config /agent/config
COPY api/package.json api/package-lock.json* ./
RUN npm install
# The API and imported agent must resolve the same physical DB package singleton.
RUN rm -rf /agent/node_modules/@linkrowth/db \
  && ln -s /app/node_modules/@linkrowth/db /agent/node_modules/@linkrowth/db

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /db /db
COPY --from=deps /agent /agent
COPY api/package.json api/tsconfig.json ./
COPY api/src ./src
# Agent is already compiled in agent-build; skip api prebuild (needs agent src/tsconfig).
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY api/package.json api/package-lock.json* ./
COPY --from=deps /db /db
COPY --from=deps /agent /agent
RUN npm install --omit=dev \
  && rm -rf /agent/node_modules/@linkrowth/db \
  && ln -s /app/node_modules/@linkrowth/db /agent/node_modules/@linkrowth/db \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
