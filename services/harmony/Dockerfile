ARG BASE_IMAGE=node:18-buster
FROM $BASE_IMAGE
RUN apt update && apt-get -y install sqlite3 python3 python3-pip python3-setuptools
RUN pip3 install --upgrade pip awscli awscli-local
# Need to downgrade boto3 because there is a bug breaking creating SQS queues
RUN pip3 install boto3==1.25.5
RUN mkdir -p /harmony/services/harmony
COPY built /harmony
RUN chown node -R /harmony
USER node
WORKDIR /harmony/packages/util
RUN env NODE_ENV=production npm ci
WORKDIR /harmony/services/harmony
RUN env NODE_ENV=production npm ci
RUN npm install sqlite3 --save
ENTRYPOINT [ "npm", "run", "start" ]
