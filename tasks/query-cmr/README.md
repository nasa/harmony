# Query CMR Task

To run:

```
SHARED_SECRET_KEY=foo ts-node . --harmony-input "$(cat example/message.json)" --query example/query.json -o tmp
```

In Docker:

```
npm run build
npm run docker-example -- --harmony-input "$(cat example/message.json)" --query example/query.json -o tmp
```
