ARG BASE_IMAGE=node:12-buster
FROM $BASE_IMAGE

COPY app tsconfig.json package.json package-lock.json ./
RUN npm install
RUN tsc

WORKDIR /app

ENTRYPOINT [ "node", "tasks/query-cmr/app/cli" ]