FROM node:16-alpine

WORKDIR /app
COPY built package.json package-lock.json ./
RUN npm install --production

ENTRYPOINT [ "node", "tasks/query-cmr/app/server.js" ]
