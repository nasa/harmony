FROM continuumio/miniconda3:24.9.2-0

WORKDIR "/function"

# Ensure pip is installed and up to date
RUN conda install --yes pip && pip install --upgrade pip setuptools

# Install the app dependencies into the base conda environment so we
# don't need to activate a conda environment when running.
COPY environment.yml .
RUN conda env update --file environment.yml -n base

ENV PROJ_LIB=/opt/conda/share/proj
ENV GDAL_DATA=/opt/conda/share/gdal

RUN pip install git+https://github.com/nasa/harmony-service-lib-py.git

# 👇🏽 Install AWS Lambda Runtime Interface Client
RUN python3 -m pip install --target "/function" awslambdaric

COPY src/* "/function"


# 👇🏽 Define the entrypoint
ENTRYPOINT ["python3", "-m", "awslambdaric"]


CMD [ "main.handler" ]