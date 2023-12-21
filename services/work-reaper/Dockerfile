FROM node:18-buster

RUN apt-get update && apt-get -y install postgresql
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