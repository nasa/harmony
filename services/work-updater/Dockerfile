FROM node:22.14.0

RUN apt-get update
RUN apt-get install -y vim git python3 postgresql-client make gcc g++ libc-dev libpq-dev
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-updater/services/work-updater

COPY package.json package-lock.json /work-updater/services/work-updater/
WORKDIR /work-updater/services/work-updater
RUN npm ci

COPY env-defaults /work-updater/services/work-updater/
COPY built /work-updater/
WORKDIR /work-updater
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-updater/node_modules .
WORKDIR /work-updater/services/work-updater

ENTRYPOINT [ "node", "app/server.js"]