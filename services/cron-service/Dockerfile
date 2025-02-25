FROM node:22.14.0-alpine

RUN apk update
RUN apk add bash vim curl git python3 postgresql-client make gcc g++ libc-dev libpq-dev
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /cron-service/services/cron-service

COPY package.json package-lock.json /cron-service/services/cron-service/
WORKDIR /cron-service/services/cron-service
RUN npm ci

COPY env-defaults /cron-service/services/cron-service/
COPY built /cron-service/
WORKDIR /cron-service
# This symlink is needed to make module loading work correctly
RUN ln -s services/cron-service/node_modules .
WORKDIR /cron-service/services/cron-service

ENTRYPOINT [ "node", "app/server.js"]