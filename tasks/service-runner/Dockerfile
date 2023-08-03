FROM node:16-alpine

RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /service-runner/lib/util
RUN mkdir -p /service-runner/tasks/service-runner
RUN mkdir -p /tmp/metadata
COPY lib/util/built /service-runner/lib/util/
# The util library env-defaults
COPY lib/util/env-defaults /service-runner/lib/util/
COPY tasks/service-runner/built /service-runner/
# The harmony server env-defaults
COPY env-defaults /service-runner/
COPY tasks/service-runner/env-defaults tasks/service-runner/package.json tasks/service-runner/package-lock.json /service-runner/tasks/service-runner/
WORKDIR /service-runner/tasks/service-runner
RUN npm ci
WORKDIR /service-runner
RUN ln -s tasks/service-runner/node_modules node_modules
WORKDIR /service-runner/tasks/service-runner

ENTRYPOINT [ "node", "app/server.js"]
