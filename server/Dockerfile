# The office server: a long-lived WebSocket process with a SQLite file.
#
# Node 22 or newer is required, not preferred: node:sqlite and
# process.loadEnvFile both arrived in 22, and the server uses each at start-up.
FROM node:24-slim

WORKDIR /app

# Manifests first, so a dependency install is only redone when they change.
# Every workspace manifest is needed for `npm ci` to match the lockfile, even
# though the web app is not installed or run here.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/

RUN npm ci --omit=dev --workspace @wtoffice/server --include-workspace-root

# TypeScript source, run through tsx — which is why tsx is a runtime dependency
# and not a build-time one.
COPY shared/src shared/src
COPY server/src server/src

ENV NODE_ENV=production
# Mount a volume here, or profile pictures, notification settings, queued
# alerts and remembered devices are lost on every restart.
ENV DB_PATH=/data/office.db
VOLUME ["/data"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@wtoffice/server"]
