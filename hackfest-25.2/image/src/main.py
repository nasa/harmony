# import numpy as np

def handler(event, context):
  # arr = np.random.randint(0, 10, (3, 3))
  print(event)
  records = event['Records']

  for record in records:
    body = record['body']
    print("BODY:\n")
    print(body)
  # return {
  #   "statusCode": 200,
  #   "body": {"message": "Hello, world!", "array": arr.tolist()}
  #   }