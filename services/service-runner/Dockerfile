FROM node:22-alpine3.22

RUN apk upgrade --no-cache
RUN apk add bash ca-certificates

RUN mkdir -p /service-runner/services/service-runner
RUN mkdir -p /tmp/metadata

COPY package.json package-lock.json /service-runner/services/service-runner/
WORKDIR /service-runner/services/service-runner
RUN npm ci --omit=dev

COPY env-defaults /service-runner/services/service-runner/
COPY built /service-runner/
WORKDIR /service-runner
# This symlink is needed to make module loading work correctly
RUN ln -s services/service-runner/node_modules .
WORKDIR /service-runner/services/service-runner

ENTRYPOINT [ "node", "app/server.js"]
