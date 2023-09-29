# Add copyright statement here

FROM ghcr.io/osgeo/gdal:alpine-small-latest 

RUN apk add bash build-base gcc g++ gfortran openblas-dev cmake python3 python3-dev libffi-dev netcdf-dev libxml2-dev libxslt-dev libjpeg-turbo-dev zlib-dev hdf5 hdf5-dev gdal-dev gdal-tools

RUN python -m ensurepip --upgrade
RUN pip3 install gdal numpy netCDF4 matplotlib harmony-service-lib

# Create a new user
RUN adduser -D -s /bin/sh -h /home/dockeruser -g "" -u 1000 dockeruser
USER dockeruser
ENV HOME /home/dockeruser

USER root
RUN mkdir -p /worker && chown dockeruser /worker
USER dockeruser
WORKDIR /worker

COPY --chown=dockeruser $SERVICE_NAME.py .

# Run the service
ENTRYPOINT ["python3", "-m", "$SERVICE_NAME"]