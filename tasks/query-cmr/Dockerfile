FROM node:16-alpine

RUN apk update
RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /query-cmr/tasks/query-cmr
RUN mkdir -p /tmp/metadata

COPY package.json package-lock.json /query-cmr/tasks/query-cmr/
COPY built /query-cmr/
WORKDIR /query-cmr/tasks/query-cmr
RUN npm update
RUN npm ci
WORKDIR /query-cmr
RUN ln -s tasks/query-cmr/node_modules .
WORKDIR /query-cmr/tasks/query-cmr

ENTRYPOINT [ "node", "app/server.js"]
