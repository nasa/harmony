ARG BASE_IMAGE=node:12-buster
FROM $BASE_IMAGE
RUN mkdir -p /harmony
COPY . /harmony
WORKDIR /harmony
RUN npm install
USER node
ENTRYPOINT [ "npm", "run", "start-dev-fast" ]