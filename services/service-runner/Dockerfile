FROM node:20-alpine

RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /service-runner/services/service-runner
RUN mkdir -p /tmp/metadata
COPY env-defaults package.json package-lock.json /service-runner/services/service-runner/
COPY built /service-runner/
WORKDIR /service-runner/services/service-runner
RUN npm ci
WORKDIR /service-runner
# This symlink is needed to make module loading work correctly
RUN ln -s services/service-runner/node_modules .
WORKDIR /service-runner/services/service-runner

ENTRYPOINT [ "node", "app/server.js"]
