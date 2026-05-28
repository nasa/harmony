FROM node:22-alpine3.22

RUN apk update && apk upgrade --no-cache
RUN apk add --no-cache python3 postgresql-client make gcc g++ libc-dev postgresql-dev ca-certificates

RUN mkdir -p /work-scheduler/services/work-scheduler

COPY package.json package-lock.json /work-scheduler/services/work-scheduler/
WORKDIR /work-scheduler/services/work-scheduler
RUN npm ci --omit=dev

COPY env-defaults /work-scheduler/services/work-scheduler/
COPY built /work-scheduler/
WORKDIR /work-scheduler
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-scheduler/node_modules .
WORKDIR /work-scheduler/services/work-scheduler

ENTRYPOINT [ "node", "app/server.js"]
