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
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app.js"]
