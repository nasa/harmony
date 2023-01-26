# Common Harmony Setup Information

The below sections detail common setup that is required for running Harmony whether you follow the Quick Start or the Develop guide. Do _not_ attempt to read this reference document all at once. Refer to it only as needed when prompted by one of the aforementioned guides.

## Earthdata Login Application Requirement

To use Earthdata Login with a locally running Harmony, you must first set up a new application in the Earthdata Login UAT environment using the Earthdata Login UI.  https://wiki.earthdata.nasa.gov/display/EL/How+To+Register+An+Application.  This is a four step process:

1. Request and receive permission to be an Application Creator
2. Create a local/dev Harmony Application in the EDL web interface
3. Add the necessary Required Application Group
4. Update .env with credentials

You must select "401" as the application type for Harmony to work correctly with command line clients and clients like QGIS. Set the redirect URL to http://localhost:3000/oauth2/redirect for local Harmony. Leave `Required User Information` and `Redirect Time for Earthdata Login Splash page` empty. Check the checkbox for `By checking this box, I confirm that my application is compatible with EDL policy`. Leave the other checkbox unchecked. Then create the new application. After the application is created, you can use the "manage" -> "App Groups" tab to add the "EOSDIS Enterprise" group to the application. This "EOSDIS Enterprise" group will allow CMR searches issued by Harmony to be able to use your Earthdata Login tokens.

If you have an .env file ready to go (see bin/create-dotenv), set `OAUTH_CLIENT_ID`, `OAUTH_UID` and `OAUTH_PASSWORD` with the information from your Earthdata Login application. If you are not ready to create a .env file, refer back to these values later on when you are ready to populate it.

## Developing Services

If you are developing a service and wish to test it locally with Harmony then you must
define the environment variables needed to run the service and execute the local deployment script.
You can do this with the following steps:

1. Build the image for your service
2. Add entries into the `env-defaults` file for your service. See the `HARMONY_SERVICE_EXAMPLE`
   entries for examples. Be sure to prefix the entries with the name of your service.
   Set the value for the `INVOCATION_ARGS` environment variable. This should be how you would run
  your service from the command line. For example, if you had a python module named `my-service`
  in the working directory, then you would run the service using
  ```bash
  python -m my-service
  ```
  So your entry for `INVOCATION_ARGS` would be
  ```shell
  MY_SERVICE_INVOCATION_ARGS='python -m my-service'
  ```
3. Add an entry for your service (lowercase) to the `.env` file:
```shell
LOCALLY_DEPLOYED_SERVICES=my-service
```
Note that the name used must be the kebab case version of the environment variable prefix used in `env-defaults`.
4. Run
```bash
./bin/deploy-services
```