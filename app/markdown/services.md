## Available Services

Harmony requests are declarative rather than imperative, so a request specifies the particular
data of interest, time range of interest, spatial bounds of interest, desired output format, etc.
Harmony then matches this declaration against available services and invokes the matching services
on behalf of the user. All of which is to say ==the user does not request specific services directly==.
Despite this, it can be useful for a user to know what services are available, what their
capabilities are, and which services can work together.

#### Service Versions
Harmony services run in containers in pods in a Kubernetes cluster. It is not possible for users
to interact directly with these pods, but it may be useful to know some of the details about
the running versions. The specific docker image and
tag for each service can be retrieved from the [versions](/versions) route.

#### Service Capabilities
The following tables provide an overview of the deployed services with a description of
each and what capabilities they provide.

{{servicesInfo}}

<br/>
<br/>
