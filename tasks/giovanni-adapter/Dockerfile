FROM node:12-alpine

WORKDIR /app
COPY built package.json package-lock.json ./
RUN npm install --production

RUN mkdir /app/tasks/giovanni-adapter/config
COPY config/giovanni-datafield.json /app/tasks/giovanni-adapter/config

ENTRYPOINT [ "node", "tasks/giovanni-adapter/app/cli" ]
