# Harmony built-in workflow tasks

This folder contains docker-based tasks for driving Harmony's Argo workflows

To run all of their tests using lerna:

```
$ lerna run test
```

To update their version numbers to match a particular deployed version without pushing to git:

```
lerna version 0.0.1 --no-git-tag-version --no-push --yes
```
