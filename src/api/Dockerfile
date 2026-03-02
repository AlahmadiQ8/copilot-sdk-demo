FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json index.ts model-config.ts client.ts ./
COPY routes/ ./routes/
RUN pnpm exec tsc && pnpm prune --prod

FROM node:24-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/package.json ./
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/node_modules ./node_modules
ENV NODE_ENV=production
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => {if(!r.ok) process.exit(1)}).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
