# ARG BASE_IMAGE=node:22.5.1-alpine
ARG BASE_IMAGE=node:22.5.1
FROM $BASE_IMAGE

# RUN apk update && apk add --no-cache sqlite sqlite-dev python3 py3-pip

RUN apt-get update && apt-get install -y sqlite3 libsqlite3-dev python3 python3-pip python3-venv libpq-dev build-essential

RUN python3 -m venv /venv
ENV PATH="/venv/bin:$PATH"

# RUN pip3 install --upgrade pip awscli awscli-local boto3==1.25.5
RUN pip install --only-binary :all: --upgrade pip awscli==1.33.37 boto3==1.34.155
RUN pip install awscli-local
RUN pip install --upgrade setuptools

RUN mkdir -p /harmony/services/harmony /harmony/packages/util
RUN chown -R node:node /harmony

# RUN apk add --no-cache postgresql-dev
# RUN apk add --no-cache build-base python3-dev

COPY --chown=node:node built/packages/util/package.json built/packages/util/package-lock.json /harmony/packages/util/
WORKDIR /harmony/packages/util
RUN env NODE_ENV=production npm ci

COPY --chown=node:node built/services/harmony/package.json built/services/harmony/package-lock.json /harmony/services/harmony/
WORKDIR /harmony/services/harmony
RUN env NODE_ENV=production npm ci
RUN npm install gdal-async ts-node-dev
# RUN ls -l
# RUN npm install sqlite3

COPY --chown=node:node built /harmony

# RUN apk add --no-cache bash

RUN echo "Listing /harmony" && ls -la /harmony
RUN echo "Listing /harmony/bin" && ls -la /harmony/bin
RUN ls -la /harmony/services/harmony/node_modules/gdal-async/lib/binding/

USER node

ENTRYPOINT [ "npm", "run", "start" ]