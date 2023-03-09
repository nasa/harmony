## Available Services

Harmony requests are declarative rather than imperative, so a request specifies the particular
data of interest, time range of interest, spatial bounds of interest, desired output format, etc.
Harmony then matches this declaration against available services and invokes the matching services
on behalf of the user. All of which is to say ==the user does not request specific services directly==.
Despite this, it can be useful for a user to know what services are available, what their
capabilities are, and which services can work together.

The following services are available.

{{servicesInfo}}

Harmony services run in containers in pods in a Kubernetes cluster. The specific docker image and
tag for each service can be retrieved from the [versions](/versions) route.