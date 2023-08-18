FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-updater/lib/util
RUN mkdir -p /work-updater/kubernetes-services/work-updater
RUN mkdir -p /tmp/metadata
COPY lib/util/built /work-updater/lib/util/
# The util library env-defaults
COPY lib/util/env-defaults /work-updater/lib/util/
COPY kubernetes-services/work-updater/built /work-updater/
# The harmony server env-defaults
COPY env-defaults /work-updater/
COPY /kubernetes-services/work-updater/env-defaults /kubernetes-services/work-updater/package.json /kubernetes-services/work-updater/package-lock.json /work-updater/kubernetes-services/work-updater/
WORKDIR /work-updater/kubernetes-services/work-updater
RUN npm ci
WORKDIR /work-updater
RUN ln -s kubernetes-services/work-updater/node_modules node_modules
WORKDIR /work-updater/kubernetes-services/work-updater

ENTRYPOINT [ "node", "app/server.js"]
