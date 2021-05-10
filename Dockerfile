ARG BASE_IMAGE=node:12-buster
FROM $BASE_IMAGE
RUN apt update && apt-get install sqlite3
RUN mkdir -p /harmony
COPY ./package.json /harmony
WORKDIR /harmony
# RUN npm install -g sqlite3
RUN npm install
COPY . /harmony
# build the sqlite dabase
RUN ./bin/create-database development
# build the cmr-granule-locator
WORKDIR /harmony/tasks/query-cmr
RUN npm install
RUN npx tsc
WORKDIR /harmony
# USER node
ENTRYPOINT [ "npm", "run", "start-dev-fast" ]