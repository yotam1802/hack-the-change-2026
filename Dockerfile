FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/ws-handlers ./apps/ws-handlers
RUN npm ci --workspace @waitwatch/server --include-workspace-root
ENV ROLE=all
ENV PORT=8787

EXPOSE 8787
CMD ["npx", "tsx", "apps/server/src/index.ts"] 
