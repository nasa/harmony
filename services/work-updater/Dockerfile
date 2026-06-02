FROM node:22-alpine3.22

RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache python3 postgresql-client make gcc g++ libc-dev postgresql-dev ca-certificates

RUN mkdir -p /work-updater/services/work-updater

COPY package.json package-lock.json /work-updater/services/work-updater/
WORKDIR /work-updater/services/work-updater
RUN npm ci --omit=dev

COPY env-defaults /work-updater/services/work-updater/
COPY built /work-updater/
WORKDIR /work-updater
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-updater/node_modules .
WORKDIR /work-updater/services/work-updater

ENTRYPOINT [ "node", "app/server.js"]