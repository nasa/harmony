# FROM node:12-alpine
FROM node:12-buster

WORKDIR /app
COPY built package.json package-lock.json ./
RUN npm install --production

ENTRYPOINT [ "node", "tasks/query-cmr/app/cli" ]