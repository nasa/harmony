# Query CMR Task

Queries the CMR using a Harmony message and queries provided on the command line, producing output files for
each page of each query.  See the CLI usage message for documentation on options.

To run:

```
SHARED_SECRET_KEY=foo ts-node app/cli --harmony-input "$(cat example/message.json)" --query example/query.json -o temp
```

To build and run in Docker:

```
npm run build
npm run docker-example -- --harmony-input '$(cat example/message.json)' --query example/query.json -o temp
```

To test:

```
npm run test
```
