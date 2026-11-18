FROM node:22.23.4-alpine3.24

RUN apk update && apk upgrade --no-cache
# DuckDB's native bindings need the C++ runtime
RUN apk add --no-cache libstdc++ ca-certificates

RUN mkdir -p /analytics-query/services/analytics-query

COPY package.json package-lock.json /analytics-query/services/analytics-query/
WORKDIR /analytics-query/services/analytics-query
RUN npm ci --omit=dev

# The service locks DuckDB down so that no query can install or load extensions, which also stops
# DuckDB installing them on first use - so install the ones reading the Iceberg tables needs now
RUN node -e "require('@duckdb/node-api').DuckDBInstance.create(':memory:') \
  .then((instance) => instance.connect()) \
  .then((conn) => conn.run('INSTALL aws; INSTALL httpfs; INSTALL avro; INSTALL iceberg;'))"

COPY env-defaults /analytics-query/services/analytics-query/
COPY built /analytics-query/
WORKDIR /analytics-query
# This symlink is needed to make module loading work correctly
RUN ln -s services/analytics-query/node_modules .
WORKDIR /analytics-query/services/analytics-query

ENTRYPOINT [ "node", "app/server.js"]
