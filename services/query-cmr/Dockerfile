FROM node:22.14.0

RUN apt-get update
RUN apt-get install -y vim
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /query-cmr/services/query-cmr
RUN mkdir -p /tmp/metadata

COPY package.json package-lock.json /query-cmr/services/query-cmr/
WORKDIR /query-cmr/services/query-cmr
RUN npm ci

COPY built /query-cmr/
WORKDIR /query-cmr
# This symlink is needed to make module loading work correctly
RUN ln -s services/query-cmr/node_modules .
WORKDIR /query-cmr/services/query-cmr

ENTRYPOINT [ "node", "app/server.js"]
