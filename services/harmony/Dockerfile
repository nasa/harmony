ARG BASE_IMAGE=node:22.5.1
FROM $BASE_IMAGE

RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev python3 python3-pip python3-venv libpq-dev build-essential

RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

RUN pip install --only-binary :all: --upgrade pip awscli==1.33.37 boto3==1.34.155
RUN pip install awscli-local
RUN pip install --upgrade setuptools

RUN mkdir -p /harmony/services/harmony /harmony/packages/util
RUN chown -R node:node /harmony

COPY --chown=node:node built/packages/util/package.json built/packages/util/package-lock.json /harmony/packages/util/
WORKDIR /harmony/packages/util
RUN env NODE_ENV=production npm ci

COPY --chown=node:node built/services/harmony/package.json built/services/harmony/package-lock.json /harmony/services/harmony/
WORKDIR /harmony/services/harmony
RUN env NODE_ENV=production npm ci
RUN npm install gdal-async ts-node-dev

COPY --chown=node:node built /harmony

USER node

ENTRYPOINT [ "npm", "run", "start" ]