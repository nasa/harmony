FROM node:16-bookworm

# RUN apk update
# RUN apk add bash vim curl git python3 postgresql-client make gcc g++ libc-dev libpq-dev
RUN apt-get install bash curl git python3 make gcc g++ libc-dev libpq-dev
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /harmony-work-scheduler
RUN mkdir -p /tmp/metadata
COPY built env-defaults package.json package-lock.json /harmony-work-scheduler/
WORKDIR /harmony-work-scheduler
RUN npm ci

ENTRYPOINT [ "node", "kubernetes-services/work-scheduler/app/server.js"]
