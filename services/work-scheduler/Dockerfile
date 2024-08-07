FROM node:22.5.1-alpine

RUN apk update
RUN apk add bash vim curl git python3 postgresql-client make gcc g++ libc-dev libpq-dev
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-scheduler/services/work-scheduler

COPY package.json package-lock.json /work-scheduler/services/work-scheduler/
WORKDIR /work-scheduler/services/work-scheduler
RUN npm ci

COPY env-defaults /work-scheduler/services/work-scheduler/
COPY built /work-scheduler/
WORKDIR /work-scheduler
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-scheduler/node_modules .
WORKDIR /work-scheduler/services/work-scheduler

ENTRYPOINT [ "node", "app/server.js"]
