FROM node:16-alpine

RUN apk update
RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /giovanni-adapter/tasks/giovanni-adapter
RUN mkdir -p /tmp/metadata

COPY package.json package-lock.json /giovanni-adapter/tasks/giovanni-adapter/
COPY built /giovanni-adapter/
COPY config/giovanni-datafield.json /giovanni-adapter/tasks/giovanni-adapter/config
WORKDIR /giovanni-adapter/tasks/giovanni-adapter
RUN npm ci
WORKDIR /giovanni-adapter
# This symlink is needed to make module loading work correctly
RUN ln -s tasks/giovanni-adapter/node_modules .

ENTRYPOINT [ "node", "app/cli.js" ]
