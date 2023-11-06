FROM node:18-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-scheduler/services/work-scheduler

COPY env-defaults package.json package-lock.json /work-scheduler/services/work-scheduler/
COPY built /work-scheduler/
WORKDIR /work-scheduler/services/work-scheduler
RUN npm ci
WORKDIR /work-scheduler
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-scheduler/node_modules .
WORKDIR /work-scheduler/services/work-scheduler

ENTRYPOINT [ "node", "app/server.js"]
