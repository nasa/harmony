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
import numpy as np
import geopandas as gpd
import contextily as ctx

import requests
from cachecontrol import CacheController, CacheControlAdapter

def _build_session():
    result = requests.session()

    # Set up caching.  Particularly obey and cache 307 redirects to avoid duplicate expensive calls when we already
    # have a result
    cache_adapter = CacheControlAdapter()
    cache_adapter.controller = CacheController(cache=cache_adapter.cache, status_codes=(200, 203, 300, 301, 307))

    result.mount('http://', cache_adapter)
    result.mount('https://', cache_adapter)
    return result

session = _build_session()

def debug_http():
  """
  Adds debugging output to HTTP requests to show redirects, headers, etc
  """
  http_client.HTTPConnection.debuglevel = 1
  logging.basicConfig()
  logging.getLogger().setLevel(logging.DEBUG)
  requests_log = logging.getLogger("requests.packages.urllib3")
  requests_log.setLevel(logging.DEBUG)
  requests_log.propagate = True

def request(*args, **kwargs):
  req = requests.Request(*args, **kwargs)
  prepped = session.prepare_request(req)

  print('%s %s' % (prepped.method, prepped.path_url))
  response = session.send(prepped)
  print('Received %s' % (response.headers.get('Content-Type', 'unknown content',)))
  return response

def get(*args, **kwargs):
  return request('GET', *args, **kwargs)

def post(*args, **kwargs):
  return request('POST', *args, **kwargs)

def show_shape(filename, basemap=True):
  shape = gpd.read_file(filename).to_crs(epsg=3857)
  plot = shape.plot(alpha=0.5, edgecolor='k', figsize=(8, 8))
  if basemap:
    ctx.add_basemap(plot)

def show(response, color_index=None, immediate=True):
  plt.rcParams["figure.figsize"] = [16, 8]

  content_type = response.headers['Content-Type']
  if content_type == 'application/x-netcdf':
    data = H5File(BytesIO(response.content), 'r')
    datasets = [data[v] for v in ['red_var', 'green_var', 'blue_var', 'alpha_var'] if v in data]
    arrays = []
    for ds in datasets:
      values = np.flip(ds[0,:], 0)
      where = (values != ds.attrs.get('_FillValue', None))
      scale = ds.attrs.get('scale_factor', [1])[0]
      offset = ds.attrs.get('add_offset', [0])[0]
      array = np.where(where, values * scale + offset, values)
      arrays.append(array)
    plt.imshow(np.dstack(arrays))
  elif content_type in ['application/octet-stream', 'application/zip', 'application/shapefile+zip']:
    tmp = tempfile.NamedTemporaryFile(suffix='.shp.zip', delete=False)
    try:
      tmp.write(response.content)
      show_shape('zip://' + tmp.name, immediate)
    finally:
      pass #os.unlink(tmp.name)
  else:
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
  return [link['href'] for link in response.json()['links'] if link.get('rel', 'data') == 'data']

def show_async(response):
  def show_response(response, link_count):
    print('Async response at', datetime.now().strftime("%H:%M:%S"))
    print(json.dumps(response.json(), indent=2))
    links = get_data_urls(response)
    new_links = links[slice(link_count, None)]
    for link in new_links:
      if link.startswith('http'):
        show(get(link))
    return len(links)

  displayed_link_count = 0
  body = response.json()
  displayed_link_count = show_response(response, displayed_link_count)
  waiting_message_printed = False
  while body['status'] not in ['successful', 'failed']:
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
  print('Async request is complete')
  return response

