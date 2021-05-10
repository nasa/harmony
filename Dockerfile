ARG BASE_IMAGE=node:12-buster
FROM $BASE_IMAGE
RUN mkdir -p /harmony
COPY ./package.json /harmony
WORKDIR /harmony
RUN npm install
COPY . /harmony
USER node
ENTRYPOINT [ "npm", "run", "start-dev-fast" ]