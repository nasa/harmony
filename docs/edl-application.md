# Earthdata Login Application (Optional)

For most Harmony functionality an Earthdata Login (EDL) application is not required. However for developers that need to work on functionality including admin endpoints such as /service-image-tag, /admin/jobs, or /admin/workflow-ui an EDL client application is needed.

To use an EDL client application with a locally running Harmony, you must first [set up a new application](https://wiki.earthdata.nasa.gov/display/EL/How+To+Register+An+Application) in the Earthdata Login **UAT** environment using the Earthdata Login UI.  This is a four step process:

1. Request and receive permission to be an Application Creator
2. Create a local/dev Harmony Application in the EDL web interface
3. Add the necessary Required Application Group
4. Update .env with credentials

Select "OAuth 2" as the application type. Set the redirect URL to http://localhost:3000/oauth2/redirect for local Harmony. Leave `Required User Information` and `Redirect Time for Earthdata Login Splash page` empty. Check the checkbox for `By checking this box, I confirm that my application is compatible with EDL policy`. Leave the other checkbox unchecked. Then create the new application. After the application is created, you can use the "manage" -> "App Groups" tab to add the "EOSDIS Enterprise" group to the application. This "EOSDIS Enterprise" group will allow CMR searches issued by Harmony to be able to use your Earthdata Login tokens.

If you have an .env file ready to go (see bin/create-dotenv), set `OAUTH_CLIENT_ID`, `OAUTH_UID` and `OAUTH_PASSWORD` with the information from your Earthdata Login application. If you are not ready to create a .env file, refer back to these values later on when you are ready to populate it. If you previously set up your harmony environment to not use an EDL client be sure to remove `USE_EDL_CLIENT_APP` from your .env file to use the default setting, or set `USE_EDL_CLIENT_APP=true`.