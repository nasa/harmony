import argparse
import boto3
import subprocess
from collections import defaultdict
from dotenv import dotenv_values
import os
import psycopg2
from psycopg2 import OperationalError

# Create a dictionary to store image to deployment name mappings
image_to_deployment_name = {}

# Returns env variables parsed from the given file
def parse_env_file(file_path):
    try:
        env_vars = dotenv_values(file_path)
        return env_vars
    except Exception as e:
        print("Error:", e)
        return {}

# Get the service name from the IMAGE configurations in env_vars
def get_prefixes_of_image_keys(env_vars):
    prefixes = [key.replace("_IMAGE", "").lower().replace("_", "-") for key in env_vars.keys() if key.endswith("_IMAGE")]
    return prefixes

# Get the deployments with the same prefix (service name)
def get_deployments_by_prefix(image_prefixes):
    global environment_name, kube_config
    deployment_counts = defaultdict(list)
    try:
        # Run `kubectl` command to get deployments
        result = subprocess.run(["kubectl", "-n", "harmony", "--kubeconfig", kube_config, "get", "deployments"], capture_output=True, text=True)
        if result.returncode == 0:
            # Split the output into lines
            lines = result.stdout.split("\n")
            # Iterate through lines, ignoring header
            for line in lines[1:]:
                # Split the line into columns
                columns = line.split()
                # Ensure columns exist and contain deployment name
                if len(columns) > 0:
                    deployment_name = columns[0]
                    # Iterate through image prefixes
                    for prefix in image_prefixes:
                        # Count deployments starting with the prefix
                        if deployment_name.startswith(prefix):
                            deployment_counts[prefix].append(deployment_name)
        else:
            print("Error running kubectl command:", result.stderr)
    except Exception as e:
        print("Error:", e)
    return deployment_counts

# Get the deployment service image for the given deployment name
def get_deployment_image(deployment_name):
    global kube_config
    try:
        # Run `kubectl describe` command to get deployment details
        result = subprocess.run(["kubectl", "-n", "harmony", "--kubeconfig", kube_config, "describe", "deployment", deployment_name], capture_output=True, text=True)
        if result.returncode == 0:
            # Split the output into lines
            lines = result.stdout.split("\n")
            # Iterate through lines to find the image
            for line in lines:
                if line.strip().startswith("Image:"):
                    # Extract the image value
                    return line.strip().split(" ")[-1]
        else:
            print(f"Error running kubectl describe command for {deployment_name}: {result.stderr}")
    except Exception as e:
        print(f"Error getting image for {deployment_name}: {e}")
    return None

# Get all images for deployments with more than one deployment for the same service
def get_all_images(deployments_dict):
    global image_to_deployment_name
    images = []
    for deployments in deployments_dict.values():
        for deployment in deployments:
            image = get_deployment_image(deployment)
            if image:
                images.append(image)
                image_to_deployment_name[image] = deployment
    return images

# Get all images with active jobs based on db query
def get_all_images_in_use():
    global db_password
    images = []
    query = """
select distinct "serviceID" from workflow_steps
where "jobID" in (select "jobID" from jobs
                  where status not in ('successful', 'canceled', 'failed', 'complete_with_errors'))
"""
    try:
        # Connect to PostgreSQL database
        connection = psycopg2.connect(
            user="harmony",
            password=db_password,
            host="localhost",
            port="1234",
            database="harmony"
        )

        # Create a cursor object using the connection
        cursor = connection.cursor()

        # Execute the query
        cursor.execute(query)
        rows = cursor.fetchall()
        for row in rows:
            images.append(row[0])

    except OperationalError as e:
        print("Error:", e)
    finally:
        # Close the cursor and connection
        if connection:
            cursor.close()
            connection.close()

    return images

# Get all configured service images from s3
def get_configured_images_from_s3(bucket_name):
    # Create an S3 client
    s3 = boto3.client('s3')

    # List all objects in the bucket
    response = s3.list_objects_v2(Bucket=bucket_name)

    # Initialize an empty list to store lines from all files
    all_lines = []

    # Iterate over each object in the bucket
    for obj in response.get('Contents', []):
        # Get the object key (file path)
        obj_key = obj['Key']

        # Get the object (file) content
        file_obj = s3.get_object(Bucket=bucket_name, Key=obj_key)

        # Read lines from the object content
        lines = file_obj['Body'].read().decode('utf-8').splitlines()

        # Append lines to the list of all lines
        all_lines.extend(lines)

    return all_lines

# Returns a list of images that can be removed based on the three input lists of images
def removable_images(all_images, images_in_use, configured_images):
    # Create a set of images in use and configured images
    used_images_set = set(images_in_use + configured_images)
    # Use set difference to remove images in use and configured images from all images
    remaining_images = [image for image in all_images if image not in used_images_set]
    return remaining_images

# Delete the specified Kubernetes target with the given name
def delete(target, instance_name):
    global kube_config
    try:
        result = subprocess.run(["kubectl", "-n", "harmony", "--kubeconfig", kube_config, "delete", target, instance_name], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"Deleted {target}: {instance_name}")
        else:
            print(f"Error deleting {target} for {instance_name}: {result.stderr}")
    except Exception as e:
        print(f"Exception deleting {target} for {instance_name}: {e}")
    return None

# Delete kubernetes deployment, hpa and service for the given list of image names
def delete_all(images_to_delete):
    global image_to_deployment_name
    print("Deleting removable deployments...")
    for image in images_to_delete:
        deployment_name = image_to_deployment_name[image]
        # hpa and service names are the same as deployment name
        delete('hpa', deployment_name)
        delete('service', deployment_name)
        delete('deployment', deployment_name)

# Main
parser = argparse.ArgumentParser()
parser.add_argument('-a', '--auto_approve', action='store_true', help='auto approve the cleanup actions')
parser.add_argument('-d', '--debug', action='store_true', help='enable debug mode')
parser.add_argument("environment_name", help="Harmony environment, e.g. sandbox, sit, uat, prod")
args = parser.parse_args()
auto = args.auto_approve
debug = args.debug
environment_name = args.environment_name

profile = os.environ.get('AWS_PROFILE')
kube_config = os.environ.get('KUBE_CONFIG')
db_password = os.environ.get('DB_PASSWORD')

if environment_name not in profile:
    print(f"Error: AWS_PROFILE '{profile}' does not match harmony environment '{environment_name}'")
    exit(1)

# Define the path to your .env file
env_file_path = "../services/harmony/env-defaults"

# Parse the .env file
env_vars = parse_env_file(env_file_path)

# Get the prefixes of keys ending with "_IMAGE"
image_prefixes = get_prefixes_of_image_keys(env_vars)

# Get deployments by prefix
deployments_by_prefix = get_deployments_by_prefix(image_prefixes)

# Filter deployments with count greater than 1
filtered_deployments = {prefix: deployments for prefix, deployments in deployments_by_prefix.items() if len(deployments) > 1}

# Get all images for deployments with more than one deployment
all_images = get_all_images(filtered_deployments)
if debug:
    print("All images for deployments with more than one deployment:")
    for image in all_images:
        print(image)

# Get images that are current in use
images_in_use = get_all_images_in_use()
if debug:
    print('==========image in use==========')
    for image in images_in_use:
        print(image)

# Name of the S3 bucket with service image configuration
bucket_name = f"harmony-{environment_name}-service-images"

# Read all files from the S3 bucket and put lines into a single list
configured_images = get_configured_images_from_s3(bucket_name)
if debug:
    print('=======configured images=============')
    for image in configured_images:
        print(image)

removable_images = removable_images(all_images, configured_images, images_in_use)
if debug:
    print('=======removable images=============')
    for image in removable_images:
        print(image)

print('Removable deployments:')
for image in removable_images:
    deployment_name = image_to_deployment_name[image]
    print(deployment_name)
print('')

if auto:
    delete_all(removable_images)
else:
    print("\033[1mDo you want to delete all removable deployments? Only 'yes' will be accepted to confirm.")
    print("Enter a value: \033[0m", end=" ")
    user_input = input()

    # Compare the input with "yes" (case insensitive)
    if user_input.lower() == "yes":
        delete_all(removable_images)
    else:
        print("No action taken. Exiting...")

