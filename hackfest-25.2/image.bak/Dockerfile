FROM continuumio/miniconda3:24.9.2-0

WORKDIR "/home"

# Ensure pip is installed and up to date
RUN conda install --yes pip && pip install --upgrade pip setuptools

# Install the app dependencies into the base conda environment so we
# don't need to activate a conda environment when running.
COPY environment.yml .
RUN conda env update --file environment.yml -n base

ENV PROJ_LIB=/opt/conda/share/proj
ENV GDAL_DATA=/opt/conda/share/gdal

# This is below the preceding layer to prevent Docker from rebuilding the
# previous layer (forcing a conda reload of dependencies) whenever the
# status of a local service library changes
ARG service_lib_dir=NO_SUCH_DIR

# Install a local harmony-service-lib-py if we have one
COPY deps ./deps/
RUN if [ -d "deps/${service_lib_dir}" ]; then \
      echo "Installing from local copy of harmony-service-lib"; \
      cd deps/${service_lib_dir} && pip install .; \
    else \
      echo "No local harmony-service-lib found, skipping install."; \
    fi

# Copy the app. This step is last so that Docker can cache layers for the steps above
COPY . .

ENTRYPOINT ["python", "-m", "harmony_service_example"]