FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /harmony-work-scheduler
RUN mkdir -p /tmp/metadata
COPY built env-defaults package.json package-lock.json /harmony-work-scheduler/
WORKDIR /harmony-work-scheduler
RUN npm ci

ENTRYPOINT [ "node", "kubernetes-services/work-scheduler/app/server.js"]
