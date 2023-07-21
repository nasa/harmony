FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /harmony-work-updater
COPY built env-defaults package.json package-lock.json /harmony-work-updater/
WORKDIR /harmony-work-updater
RUN npm ci

ENTRYPOINT [ "node", "kubernetes-services/work-updater/app/server.js"]
