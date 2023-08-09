FROM node:16-alpine

RUN apk update
RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /query-cmr/lib/util
RUN mkdir -p /query-cmr/tasks/query-cmr
RUN mkdir -p /tmp/metadata
COPY lib/util/built /query-cmr/lib/util/
# The util library env-defaults
COPY lib/util/env-defaults /query-cmr/lib/util/
COPY tasks/query-cmr/built /query-cmr/
# The harmony server env-defaults
COPY env-defaults /query-cmr/
COPY tasks/query-cmr/package.json tasks/query-cmr/package-lock.json /query-cmr/tasks/query-cmr/
WORKDIR /query-cmr/tasks/query-cmr
RUN npm update
RUN npm ci
WORKDIR /query-cmr
RUN ln -s tasks/query-cmr/node_modules node_modules
WORKDIR /query-cmr/tasks/query-cmr

ENTRYPOINT [ "node", "app/server.js"]
