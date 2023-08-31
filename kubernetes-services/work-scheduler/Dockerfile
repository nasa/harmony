FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-scheduler/kubernetes-services/work-scheduler

COPY env-defaults package.json package-lock.json /work-scheduler/kubernetes-services/work-scheduler/
COPY built /work-scheduler/
WORKDIR /work-scheduler/kubernetes-services/work-scheduler
RUN npm ci
WORKDIR /work-scheduler
# This symlink is needed to make module loading work correctly
RUN ln -s kubernetes-services/work-scheduler/node_modules .
WORKDIR /work-scheduler/kubernetes-services/work-scheduler

ENTRYPOINT [ "node", "app/server.js"]
