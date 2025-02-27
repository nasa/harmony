FROM node:22.14.0

RUN apt-get update
RUN apt-get install -y vim git python3 postgresql-client make gcc g++ libc-dev libpq-dev

RUN git config --global url."https://".insteadOf ssh://

RUN mkdir -p /work-failer/services/work-failer

COPY package.json package-lock.json /work-failer/services/work-failer/
WORKDIR /work-failer/services/work-failer
RUN npm ci

COPY env-defaults /work-failer/services/work-failer/
COPY built /work-failer/
WORKDIR /work-failer
# This symlink is needed to make module loading work correctly
RUN ln -s services/work-failer/node_modules .
WORKDIR /work-failer/services/work-failer

ENTRYPOINT [ "node", "app/server.js"]