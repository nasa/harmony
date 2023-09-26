FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-reaper/kubernetes-services/work-reaper
COPY env-defaults package.json package-lock.json /work-reaper/kubernetes-services/work-reaper/
COPY built /work-reaper/
WORKDIR /work-reaper/kubernetes-services/work-reaper
RUN npm ci
WORKDIR /work-reaper
# This symlink is needed to make module loading work correctly
RUN ln -s kubernetes-services/work-reaper/node_modules .
WORKDIR /work-reaper/kubernetes-services/work-reaper

ENTRYPOINT [ "node", "app/server.js"]