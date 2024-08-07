FROM node:22.5.1-alpine

RUN apk update
RUN apk add bash vim curl git python3 postgresql-client make gcc g++ libc-dev libpq-dev
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-reaper/services/work-reaper

COPY package.json package-lock.json /work-reaper/services/work-reaper/
WORKDIR /work-reaper/services/work-reaper
RUN npm ci

COPY env-defaults /work-reaper/services/work-reaper/
COPY built /work-reaper/
WORKDIR /work-reaper
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-reaper/node_modules .
WORKDIR /work-reaper/services/work-reaper

ENTRYPOINT [ "node", "app/server.js"]