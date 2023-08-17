FROM node:16-alpine

WORKDIR /app
COPY tasks/giovanni-adapter/built tasks/giovanni-adpater/package.json tasks/giovanni-adapter/package-lock.json ./
RUN npm install --production

COPY tasks/giovanni-adapter/config/giovanni-datafield.json /app/tasks/giovanni-adapter/config

ENTRYPOINT [ "node", "tasks/giovanni-adapter/app/cli" ]
