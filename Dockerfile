FROM node:26-alpine

# tini forwards SIGTERM to node, which ignores it when running as PID 1
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 8080

# GET /health fails while MongoDB is disconnected, or when the monitor of the webapp process stops
# reaching the API. It uses the default server.port: override it in compose.yaml when the port
# changes, and disable it for a container that runs `node monitor.js` (see README)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/health"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app.js"]
