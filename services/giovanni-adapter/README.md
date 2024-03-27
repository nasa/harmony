# Giovanni Adapter Task

Composes Giovanni URL and provides output file
See the CLI usage message for documentation on options.

To run:

```
SHARED_SECRET_KEY=foo ts-node app/cli --harmony-input "$(cat example/message.json)" -o temp
```

To build and run in Docker:

```
pnpm build
pnpm docker-example -- --harmony-input '$(cat example/message.json)' -o temp
```

To test:

```
pnpm test
```
