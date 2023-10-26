FROM node:20-buster

RUN apt-get update && apt-get -y install postgresql
RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-failer/services/work-failer
COPY env-defaults package.json package-lock.json /work-failer/services/work-failer/
COPY built /work-failer/
WORKDIR /work-failer/services/work-failer
RUN npm ci
WORKDIR /work-failer
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-failer/node_modules .
WORKDIR /work-failer/services/work-failer

ENTRYPOINT [ "node", "app/server.js"]