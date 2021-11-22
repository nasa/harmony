FROM node:12-alpine

RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://
RUN npm install -g npm@7

RUN mkdir -p /service-runner
RUN mkdir -p /tmp/metadata
COPY built env-defaults package.json package-lock.json /service-runner/
WORKDIR /service-runner
RUN npm ci
# RUN chown -R node /service-runner
# USER node

ENTRYPOINT [ "node", "tasks/service-runner/app/server.js"]
