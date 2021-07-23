ARG BASE_IMAGE=harmonyservices/service-example
FROM ${BASE_IMAGE}

RUN addgroup -S node && adduser -S node -G node
RUN apk add npm bash vim
RUN npm install -g npm@7

RUN mkdir -p /service-wrapper
RUN mkdir -p /tmp/metadata
COPY package.json package-lock.json /service-wrapper/
WORKDIR /service-wrapper
RUN npm ci
COPY . /service-wrapper/
RUN chown -R node /service-wrapper
USER node

ENTRYPOINT [ "npm", "run", "start" ]