# Query CMR Task

To run:

```
SHARED_SECRET_KEY=foo ts-node app/cli --harmony-input "$(cat example/message.json)" --query example/query.json -o temp
```

In Docker:

```
npm run build
npm run docker-example -- --harmony-input "$(cat example/message.json)" --query example/query.json -o temp
```
