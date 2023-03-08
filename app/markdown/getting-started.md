## Getting Started
All users will need an [Earthdata Login](edl) account in order access NASA data and services.
Once a user has an EDL username and password they will need to use these to access Harmony.
They can be used directly in a browser request (the browser will prompt for them) or cur `curl`
request or in code the easiest approach is to use a [.netrc file](https://everything.curl.dev/usingcurl/netrc).

A sample `.netrc` file looks like this

```
machine {{edl}} login my-edl-user-name password my-edl-password
```

