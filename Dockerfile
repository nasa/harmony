ARG BASE_IMAGE=node:18-buster
FROM $BASE_IMAGE as base
RUN apt update && apt-get -y install sqlite3 python3 python3-pip python3-setuptools vim curl telnet
RUN pip3 install --upgrade pip awscli awscli-local
# Need to downgrade boto3 because there is a bug breaking creating SQS queues
RUN pip3 install boto3==1.25.5
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# TODO add a layer that installs gdal npm modules so we can cache the layer, otherwise
# we have to build this layer every time the source changes and the gdal deps take forever
FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM build AS deploy
RUN pnpm run -r bld
RUN pnpm --filter="@harmony/harmony" --prod deploy /prod/harmony
RUN pnpm --filter="@harmony/service-runner" --prod deploy /prod/service-runner

FROM deploy AS harmony
COPY --from=deploy /prod/harmony /prod/harmony
WORKDIR /prod/harmony
EXPOSE 3000
CMD [ "pnpm", "start" ]

FROM deploy AS service-runner
COPY --from=deploy /prod/service-runner /prod/service-runner
WORKDIR /prod/service-runner
EXPOSE 5000
CMD [ "pnpm", "start" ]
