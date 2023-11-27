### <a name="versions-details"></a> Getting the versions of images used in each of the Harmony backend service chains

Using the `versions` endpoint, a user can get a list of all of the docker images and versions used in harmony backend service chains. Service providers use this endpoint to verify the versions of their services deployed to an environment.

#### Get backend service version information

```

{{root}}/versions

```
**Example {{exampleCounter}}** - Getting backend service versions using the `versions` API

The returned JSON response is an array of service version information with the following fields:

| field | description                                                                                                                       |
|-------|-----------------------------------------------------------------------------------------------------------------------------------|
| name | The name of the backend service chain as defined in [services.yml](https://github.com/nasa/harmony/blob/main/config/services.yml). |
| images | An array of the images used in the service chain.                                                                                |

Each image has the following fields:
| field | description                                                        |
|-------|--------------------------------------------------------------------|
| image | The name of the docker image.                                      |
| tag | The docker image tag.                                                |
| lastUpdated | (optional) The time the image was last updated if available. |
| imageDigest | (optional) The image digest if available.                    |

---
**Table {{tableCounter}}** - Harmony versions response fields