FROM node:12-alpine

RUN apk add bash vim

RUN mkdir -p /service-runner
RUN mkdir -p /tmp/metadata
COPY built env-defaults package.json package-lock.json /service-runner/
WORKDIR /service-runner
RUN npm ci
RUN chown -R node /service-runner
USER node

ENTRYPOINT [ "node", "tasks/service-runner/app/server.js"]