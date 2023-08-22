FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-updater/kubernetes-services/work-updater
COPY env-defaults package.json package-lock.json /work-updater/kubernetes-services/work-updater/
COPY built /work-updater/
WORKDIR /work-updater/kubernetes-services/work-updater
RUN npm ci
WORKDIR /work-updater
# This symlink is needed to make module loading work correctly
RUN ln -s kubernetes-services/work-updater/node_modules .
WORKDIR /work-updater/kubernetes-services/work-updater

ENTRYPOINT [ "node", "app/server.js"]