FROM node:22.5.1-alpine

RUN apk update
RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /giovanni-adapter/services/giovanni-adapter
RUN mkdir -p /tmp/metadata

COPY package.json package-lock.json /giovanni-adapter/services/giovanni-adapter/
WORKDIR /giovanni-adapter/services/giovanni-adapter
RUN npm ci

COPY built /giovanni-adapter/
COPY config/giovanni-datafield.json /giovanni-adapter/services/giovanni-adapter/config
WORKDIR /giovanni-adapter
# This symlink is needed to make module loading work correctly
RUN ln -s services/giovanni-adapter/node_modules .

ENTRYPOINT [ "node", "app/cli.js" ]
