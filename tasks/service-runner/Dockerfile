FROM node:16-alpine

RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /service-runner
RUN mkdir -p /tmp/metadata
COPY built env-defaults package.json package-lock.json /service-runner/
WORKDIR /service-runner
RUN npm ci

ENTRYPOINT [ "node", "tasks/service-runner/app/server.js"]
