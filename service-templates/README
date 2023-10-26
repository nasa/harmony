The dockerfile has been configured to include gdal. You should modify it to include any other
dependencies you may need for your service.

Build the service image using the ./build-service script.

If your service performs a transformation on a single file you can modify the example code in
the process_item method in the .py file to put your service logic. If your service processes
many files at once you'll need to override and implement the invoke method.

See https://github.com/nasa/harmony-service-lib-py for detailed information on implementing a
harmony service.
