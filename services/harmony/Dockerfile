ARG BASE_IMAGE=node:18-buster
FROM $BASE_IMAGE

RUN apt update && apt-get -y install sqlite3 python3 python3-pip python3-setuptools
RUN pip3 install --upgrade pip awscli awscli-local
RUN pip3 install boto3==1.25.5

RUN mkdir -p /harmony/services/harmony /harmony/packages/util
RUN chown -R node:node /harmony

COPY --chown=node:node built/packages/util/package.json built/packages/util/package-lock.json /harmony/packages/util/
WORKDIR /harmony/packages/util
RUN env NODE_ENV=production npm ci

COPY --chown=node:node built/services/harmony/package.json built/services/harmony/package-lock.json /harmony/services/harmony/
WORKDIR /harmony/services/harmony
RUN npm config set fetch-retries 5 && npm config set fetch-timeout 600000 && env NODE_ENV=production npm ci
RUN npm install sqlite3

COPY --chown=node:node built /harmony

USER node

ENTRYPOINT [ "npm", "run", "start" ]