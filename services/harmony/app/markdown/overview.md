## Overview
Harmony provides access to services that can transform data from NASA's [Earth Observing Systems Data and Information System (EOSDIS)](https://www.earthdata.nasa.gov/eosdis/) Distributed Active Archive Centers (DAAC).
Transformations can be requested using one of two [Open Geospatial Consortium (OGC)](https://www.ogc.org/) inspired APIs.

Data processed by Harmony is staged in [AWS](https://aws.com) S3 buckets owned by NASA or optionally in user owned S3 buckets. Harmony provides signed URLs or temporary access credentials to users for data staged in NASA S3 buckets.

Data transformation requests are executed as _jobs_ in Harmony. Harmony provides the ability for users to monitor and interact with long-running jobs, both programmatically through an API and via a web-based user interface.

**This document describes the APIs and endpoints Harmony provided. You can use these APIs and endpoints to directly interact with Harmony, but the recommended official way to interact with Harmony is through [Harmony-Py](https://github.com/nasa/harmony-py).**

This documentation covers the following:

${toc}
