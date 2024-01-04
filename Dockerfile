ARG BASE_IMAGE=node:18-buster
FROM $BASE_IMAGE as base
RUN apt update && apt-get -y install sqlite3 python3 python3-pip python3-setuptools vim curl telnet
RUN pip3 install --upgrade pip awscli awscli-local
# Need to downgrade boto3 because there is a bug breaking creating SQS queues
RUN pip3 install boto3==1.25.5
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# RUN pnpm config set store-dir ~/.pnpm-store

# TODO add a layer that installs gdal npm modules so we can cache the layer, otherwise
# we have to build this layer every time the source changes and the gdal deps take forever
FROM base AS build
RUN mkdir -p /pnpm/store
RUN mkdir -p /usr/src/app/services/harmony
RUN mkdir -p /usr/src/app/packages/util
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml /usr/src/app
COPY ./services/harmony/package.json /usr/src/app/services/harmony
COPY ./packages/util/package.json /usr/src/app/packages/util
WORKDIR /usr/src/app
# RUN pnpm install --prod --frozen-lockfile
# RUN --mount=type=cache,id=pnpm,target=~/.pnpm-store pnpm install --prod --frozen-lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
# Run pnpm run -r bld

FROM build AS deploy
WORKDIR /usr/src/app
COPY . /usr/src/app
Run pnpm run -r bld
# Run pnpm --filter="@harmony/util" --prod deploy /prod/util
# RUN pnpm --filter="@harmony/harmony" --prod deploy /prod/harmony
# RUN pnpm --filter="@harmony/service-runner" --prod deploy /prod/service-runner
Run --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter="@harmony/util" --prod deploy /prod/util
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter="@harmony/harmony" --prod deploy /prod/harmony
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter="@harmony/service-runner" --prod deploy /prod/service-runner

FROM deploy AS harmony
RUN mkdir -p /harmony/services/harmony
COPY --from=deploy /prod/harmony /harmony/services/harmony
WORKDIR /harmony/services/harmony
EXPOSE 3000
CMD [ "pnpm", "start" ]

FROM deploy AS service-runner
RUN mkdir -p /service-runner/services/service-runner
RUN mkdir -p /tmp/metadata
COPY --from=deploy /prod/service-runner/built/ /service-runner/
COPY --from=deploy /prod/service-runner/env-defaults /service-runner/services/service-runner
COPY --from=deploy /prod/service-runner/node_modules /service-runner/services/service-runner/node_modules
COPY --from=deploy /prod/service-runner/package.json /servcie-runner/services/service-runner
COPY --from=deploy /prod/harmony/env-defaults /service-runner/services/harmony
COPY --from=deploy /prod/harmony/node_modules /service-runner/services/harmony/node_modules
COPY --from=deploy /prod/util/node_modules /service-runner/services/service-runner/node_modules/@harmony/util/node_modules
COPY --from=deploy /prod/util/node_modules /service-runner/services/harmony/node_modules/@harmony/util/node_modules
WORKDIR /service-runner/services/service-runner
EXPOSE 5000
CMD [ "node", "app/server.js" ]
