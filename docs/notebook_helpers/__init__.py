from contextlib import contextmanager
import http.client as http_client
import logging
from datetime import datetime
from time import sleep
import json

import tempfile
import os

from io import BytesIO
from matplotlib import pyplot as plt
from PIL import Image
from h5py import File as H5File
import xarray as xa
import numpy as np
import geopandas as gpd
import contextily as ctx

from satstac import Catalog

import requests
from cachecontrol import CacheController, CacheControlAdapter

def _build_session():
  """Builds a requests session that caches responses where possible, making redirects faster.

  Returns:
      requests.Session -- A shared session to use for the notebook
  """
  result = requests.session()

  # Set up caching.  Particularly obey and cache 307 redirects to avoid duplicate expensive calls when we already
  # have a result
  cache_adapter = CacheControlAdapter()
  cache_adapter.controller = CacheController(cache=cache_adapter.cache, status_codes=(200, 203, 300, 301, 307))

  result.mount('http://', cache_adapter)
  result.mount('https://', cache_adapter)
  return result

# Session accessible by callers
session = _build_session()

def debug_http():
  """Adds debugging output to HTTP requests to show redirects, headers, etc
  """
  http_client.HTTPConnection.debuglevel = 1
  logging.basicConfig()
  logging.getLogger().setLevel(logging.DEBUG)
  requests_log = logging.getLogger("requests.packages.urllib3")
  requests_log.setLevel(logging.DEBUG)
  requests_log.propagate = True

def request(*args, **kwargs):
  """Thin wrapper around requests.Request, logging URL sent and Content-Type received

  See https://requests.readthedocs.io/en/master/api/#requests.Request for args

  Returns:
      requests.Response -- The response to the request
  """
  req = requests.Request(*args, **kwargs)
  prepped = session.prepare_request(req)

  print('%s %s' % (prepped.method, prepped.path_url))
  response = session.send(prepped)
  #print('Received %s' % (response.headers.get('Content-Type', 'unknown content',)))
  return response

def get(*args, **kwargs):
  """Performs a GET request using the request wrapper

  See https://requests.readthedocs.io/en/master/api/#requests.Request for args

  Returns:
      requests.Response -- The response to the request
  """
  return request('GET', *args, **kwargs)

def post(*args, **kwargs):
  """Performs a POST request using the request wrapper

  See https://requests.readthedocs.io/en/master/api/#requests.Request for args

  Returns:
      requests.Response -- The response to the request
  """
  return request('POST', *args, **kwargs)

def show_shape(filename, basemap=True):
  """Plots the shapefile in the given filename with optional basemap (ESRI or GeoJSON)

  Arguments:
      filename {string} -- The filename of the shapefile to display

  Keyword Arguments:
      basemap {bool} -- Whether to display a basemap under the shapefile (default: {True})
  """
  shape = gpd.read_file(filename).to_crs(epsg=3857)
  plot = shape.plot(alpha=0.5, edgecolor='k', figsize=(8, 8))
  if basemap:
    ctx.add_basemap(plot)

def show(response, varList=[], color_index=None, immediate=True):
  """Shows a variety of responses possible from Harmony for its example data

  Handles NetCDF files with red_var, green_var, blue_var, and alpha_var bands, compositing output
  into a single colored image, ESRI Shapefiles with basemaps, and any type of image that can be
  read by PIL, including GeoTIFF

  Arguments:
      response {requests.Response} -- The response containing the data to display
      varList {array} -- If set, only plot the variables listed in varList.  Otherwise, plot all.

  Keyword Arguments:
      color_index {number} -- Set for monochromatic images to put the output in a color band (0=red, 1=green, 2=blue) (default: {None})
      immediate {bool} -- True if the data should be shown immediately in the notebook (default: {True})
      
  """


  # show_netcdf (look at dimensions, decide how to display); show_image
  plt.rcParams['figure.figsize'] = [16, 8]
  arrays = []

  check_status(response)
  content_type = response.headers['Content-Type']
  print('Content-type: ', content_type)

  if content_type == 'binary/octet-stream' or content_type == 'application/octet-stream':
    print('WARNING: Let service developer know to set their content_type correctly!')

  if content_type == 'application/x-netcdf' or content_type == 'application/netcdf' or content_type == 'binary/octet-stream' or content_type == 'application/octet-stream':
    # Show NetCDF4 
    data = H5File(BytesIO(response.content), 'r')

    #If user didn't provide any specific vars to plot, pull all of them into varList
    if (len(varList) == 0):
      varList = data.keys()
      print(varList)

    #Plot the variables requested
    for var in varList:
      if var in data and len(data[var].shape) > 0:
          if (len(data[var].shape) < 3):
            #Simple plot for 1D or 2D
            plt.plot(data[var])
            plt.show()
          else:
            #Setup for 3D display
            ds = data[var]
            values = np.flip(ds[0,:], 0)
            where = (values != ds.attrs.get('_FillValue', None))
            scale = ds.attrs.get('scale_factor', [1])[0]
            offset = ds.attrs.get('add_offset', [0])[0]
            array = np.where(where, values * scale + offset, values)
            arrays.append(array)
      else:
        print('Error: ', var, 'not found in dataset')
    if (len(arrays) != 0):
      #plot the 3D data
      plt.imshow(np.dstack(arrays))
  elif content_type in ['application/zip', 'application/shapefile+zip']:
    # Show ESRI Shapefiles
    tmp = tempfile.NamedTemporaryFile(suffix='.shp.zip', delete=False)
    try:
      tmp.write(response.content)
      show_shape('zip://' + tmp.name, immediate)
    finally:
      os.unlink(tmp.name)
  elif 'application/json' in content_type:
    #Most likely an error
    print(response.json())
    assert(False)
  else:
    # Show Images
    if color_index == None:
      plt.imshow(Image.open(BytesIO(response.content)))
    else:
      gray_image = Image.open(BytesIO(response.content))
      # Move 1-channel green_var TIFF to second channel of RGB
      image = Image.new('RGB', gray_image.size)
      # There's probably a better way to do this with numpy
      if color_index == 0:
        image.putdata([(g, 0, 0) for g in gray_image.getdata()])
      if color_index == 1:
        image.putdata([(0, g, 0) for g in gray_image.getdata()])
      if color_index == 2:
        image.putdata([(0, 0, g) for g in gray_image.getdata()])
      plt.imshow(image)
  if immediate:
    plt.show()

def get_data_urls(response):
  """Returns the data URLs in an async response

  Arguments:
      response {response.Response} -- The async job response

  Returns:
      string[] -- An array of URLs for data links
  """
  return [link['href'] for link in response.json()['links'] if link.get('rel', 'data') == 'data']

def show_async(response, varList = []):
  """Shows an asynchronous Harmony response.

  Polls the output, displaying it as it changes, displaying any http data
  links in the response as they arrive, and ultimately ending once the request
  is successful or failed

  Arguments:
      response {response.Response} -- the response to display
      varList {array} -- If set, only plot the variables listed in varList.  Otherwise, plot all.

  Returns:
      response.Response -- the response from the final successful or failed poll
  """
  def show_response(response, link_count):
    print('Async response at', datetime.now().strftime("%H:%M:%S"))
    print(json.dumps(response.json(), indent=2))
    links = get_data_urls(response)
    new_links = links[slice(link_count, None)]
    for link in new_links:
      if link.startswith('http'):
        show(get(link), varList)
    return len(links)

  check_status(response)
  displayed_link_count = 0
  body = response.json()
  displayed_link_count = show_response(response, displayed_link_count)
  waiting_message_printed = False
  while body['status'] not in ['successful', 'failed', 'canceled']:
    if not waiting_message_printed:
      print('Waiting for updates...')
      waiting_message_printed = True
    sleep(1)
    progress = body['progress']
    status = body['status']
    response = session.get(response.url)
    body = response.json()
    if progress != body['progress'] or status != body['status']:
      displayed_link_count = show_response(response, displayed_link_count)
      waiting_message_printed = False

  assert(body['status'] not in ['failed'])
  check_stac(response)
  print('Async request is complete')
  return response

def print_async_status(body):
  """Prints the status, progress and any messages for the async job
  
  Arguments:
      body {json} -- the response body to display

  """
  print('JobID:',body['jobID'],'Status:',body['status'],'(',body['progress'],'%) Messages:', body['message'])

def show_async_condensed(response, varList = [], show_results=True):
  """Shows a condensed version of the asynchronous Harmony response.  Useful for getting status if you don't care about the results.

  Polls the output, displaying status as it changes, and ultimately ending once the request
  is successful or failed

  Arguments:
      response {response.Response} -- the response to display
      varList {array} -- If set, only plot the variables listed in varList.  Otherwise, plot all.
      show_results {bool} -- True will display the results as they arrive.  (default: {True})
  """
  def show_response_condensed(response, varList, link_count):
    links = get_data_urls(response)
    new_links = links[slice(link_count, None)]
    for link in new_links:
      if link.startswith('http'):
        show(get(link), varList)
    return len(links)

  check_status(response)

  displayed_link_count = 0
  body = response.json()
  print ('Getting results for request')
  print_async_status(body)
  if show_results:
    displayed_link_count = show_response_condensed(response, varList, displayed_link_count)
  while body['status'] not in ['successful', 'failed', 'canceled']:
    progress = body['progress']
    status = body['status']
    response = session.get(response.url)
    body = response.json()
    if progress != body['progress'] or status != body['status']:
      if show_results:
        displayed_link_count = show_response_condensed(response, varList, displayed_link_count)
      print_async_status(body)
  
  assert(body['status'] not in ['failed'])
  check_stac(response)
  print('Async request is complete')
  


def check_bbox_subset(response, req_lat_min, req_lat_max, req_lon_min, req_lon_max):
  """Asserts if the spatial extents of the data in the response are within the requested bbox of a spatial subset

  #####  CHECK_BBOX_SUBSET currently is not in use; placeholder for the next round of regression test work

  Arguments:
      response {response.Response} -- the response to display
      req_lat_min -- The minimimum latitude from the request bbox for a spatial subset
      req_lat_max -- The maximum latitude from the request bbox for a spatial subset
      req_lon_min -- The minimimum longitude from the request bbox for a spatial subset
      req_lon_max -- The maximum longitude from the request bbox for a spatial subset
  """

  data = H5File(BytesIO(response.content), 'r')

  attr_data = data['lat'][:]

  print('Orig min and max: ', attr_data.min(), attr_data.max() )
  lat_min = (attr_data.min() + 180) % 360 - 180
  lat_max = (attr_data.max() + 180) % 360 - 180
  print(lat_min)
  print(lat_max)

  assert lat_max <= req_lat_max 
  assert lat_min >= req_lat_min

  attr_data = data['lon'][:] 
  lon_min = (attr_data.min() + 180) % 360 - 180
  lon_max = (attr_data.max() + 180) % 360 - 180
  print(lon_min)
  print(lon_max)

  assert lon_max <= req_lon_max 
  assert lon_min >= req_lon_min

def check_status(response):
  """Asserts if the response is a 200, if not, print out the response code

  Arguments:
      response {response.Response} -- the response to display
  """
  if (response.status_code != 200):
    errStr = 'Request failed with status code ' + str(response.status_code)
    assert False, errStr

    
def check_stac(response):
  """Asserts if the response contains a valid STAC catalog and prints it out.  More robust assertions could 
    be done here in the future to confirm that the STAC metadata is valid per the request parameters

  Arguments:
      response {response.Response} -- the response to display
  """
  for i in range(len(response.json()['links'])):
    if response.json()['links'][i]['title'] == 'STAC catalog':
        stac_url = response.json()['links'][i]['href']
  
  assert(stac_url)
  cat = Catalog.open(stac_url)

  for i in cat.items():
    assert(i.id)
    assert(i.datetime)
    assert(i.bbox)
    assert(i.assets.keys())
    print('STAC Item')
    print('\t', 'ID:', i.id)
    print('\t', 'Date:', i.datetime)
    print('\t', 'Bounding Box:', i.bbox)
    print('\t', 'File:', list(i.assets.keys()))
 