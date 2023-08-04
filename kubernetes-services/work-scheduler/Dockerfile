FROM node:16-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-scheduler/lib/util
RUN mdkir -p /work-scheduler/kubernetes-services/work-scheduler
RUN mkdir -p /tmp/metadata
COPY lib/util/built /work-scheduler/lib/util/
# The util library env-defaults
COPY lib/util/env-defaults /work-scheduler/lib/util/
COPY kubernetes-services/work-scheduler/built /work-scheduler/
# The harmony server env-defaults
COPY env-defaults /work-scheduler/
COPY /kubernetes-services/work-scheduler/env-defaults /kubernetes-services/work-scheduler/package.json /kubernetes-services/work-scheduler/package-lock.json /work-scheduler/kubernetes-services/work-scheduler/
WORKDIR /work-scheduler/kubernetes-services/work-scheduler
RUN npm ci
WORKDIR /work-scheduler
RUN ln -s kubernetes-services/work-scheduler/node_modules node_modules
WORKDIR /work-scheduler/kubernetes-services/work-scheduler

ENTRYPOINT [ "node", "app/server.js"]
