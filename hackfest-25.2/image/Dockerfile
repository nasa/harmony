FROM public.ecr.aws/lambda/python:3.13

WORKDIR ${LAMBDA_TASK_ROOT}

COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install -r requirements.txt
# RUN pip install git+https://github.com/nasa/harmony-service-lib-py.git
COPY src/* ${LAMBDA_TASK_ROOT}

CMD [ "main.handler" ]