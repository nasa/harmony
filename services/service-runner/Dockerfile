FROM node:18-alpine

RUN apk add bash vim curl git
RUN git config --global url."https://".insteadOf ssh://
RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" SHELL="$(which bash)" bash -

RUN mkdir -p /service-runner/services/service-runner
RUN mkdir -p /tmp/metadata
COPY env-defaults package.json package-lock.json /service-runner/services/service-runner/
COPY built /service-runner/
WORKDIR /service-runner/services/service-runner
RUN pnpm i
WORKDIR /service-runner
# This symlink is needed to make module loading work correctly
RUN ln -s services/service-runner/node_modules .
WORKDIR /service-runner/services/service-runner

ENTRYPOINT [ "node", "app/server.js"]
