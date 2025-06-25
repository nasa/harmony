"""
==========
adapter.py
==========

Provides BaseHarmonyAdapter, an abstract base class for services to implement
the translation between Harmony messages and service calls and the translation
between service results and Harmony callbacks.
"""

import logging
import uuid
from abc import ABC
from pystac import Catalog, read_file

from harmony_service_lib.http import request_context
from harmony_service_lib.logging import build_logger
from . import util


class BaseHarmonyAdapter(ABC):
    """
    Abstract base class for Harmony service adapters.  Service implementations
    should inherit from this class and implement the `#invoke(self)` or `#process_item(self, item, source)`
    method to adapt the Harmony message (`self.message`) into a service call

    Services may choose to override methods that do data downloads and result
    staging as well, if they use a different mechanism

    Attributes
    ----------
    message : harmony_service_lib.Message
        The Harmony input which needs acting upon
    logger: Logger
        Logger specific to this request
    """

    def __init__(self, message, catalog=None, config=None):
        """
        Constructs the adapter

        Parameters
        ----------
        message : harmony_service_lib.Message
            The Harmony input which needs acting upon
        catalog : pystac.Catalog
            A STAC catalog containing the files on which to act
        config : harmony_service_lib.util.Config
            The configuration values for this runtime environment.
        """
        # set the request ID in the global context so we can use it in other places
        request_id = message.requestId if hasattr(message, 'requestId') else None
        request_context['request_id'] = request_id

        self.message = message
        self.catalog = catalog
        self.config = config

        if self.config is not None:
            self.init_logging()
        else:
            self.logger = logging.getLogger()

    def set_config(self, config):
        self.config = config
        if self.config is not None:
            self.init_logging()

    def init_logging(self):
        user = self.message.user if hasattr(self.message, 'user') else None
        req_id = self.message.requestId if hasattr(self.message, 'requestId') else None
        logging_context = {
            'user': user,
            'requestId': req_id
        }
        self.logger = logging.LoggerAdapter(build_logger(self.config), logging_context)

    def invoke(self):
        """
        Invokes the service to process `self.message`.  By default, this will call process_item
        on all items in the input catalog

        Returns
        -------
        (harmony_service_lib.Message, pystac.Catalog | list)
            A tuple of the Harmony message, with any processed fields marked as such and
            in this implementation, a single STAC catalog describing the output.
            (Services overriding this method may return a list of STAC catalogs if desired.)
        """
        # New-style processing using STAC
        if self.catalog:
            return (self.message, self._process_catalog_recursive(self.catalog))
        else:
            raise RuntimeError("The service should override the invoke function when no STAC catalog is provided.")

    def get_all_catalog_items(self, catalog: Catalog, follow_page_links=True):
        """
        Returns a lazy sequence of all the items (including from child catalogs) in the catalog.
        Can handle paged catalogs (catalogs with next/prev).

        Parameters
        ----------
        catalog : pystac.Catalog
            The catalog from which to get items
        follow_page_links : boolean
            Whether or not to follow 'next' links - defaults to True

        Returns
        -------
        A generator that can be iterated to provide a lazy sequence of `pystac.Item`s
        """
        # Return immediate items and items from sub-catalogs
        for item in catalog.get_all_items():
            yield item

        # process 'next' link if present
        if follow_page_links:
            link = catalog.get_single_link(rel='next')
            if link:
                next_catalog = read_file(link.get_href())
                next_items = self.get_all_catalog_items(next_catalog, True)
                for item in next_items:
                    yield item

    def _process_catalog_recursive(self, catalog):
        """
        Helper method to recursively process a catalog and all of its children, producing a new
        output catalog of the results

        Parameters
        ----------
        catalog : pystac.Catalog
            The catalog to process

        Returns
        -------
        pystac.Catalog
            A new catalog containing all of the processed results
        """
        result = catalog.clone()
        result.id = str(uuid.uuid4())

        # Recursively process all sub-catalogs
        children = catalog.get_children()
        result.clear_children()
        result.add_children([self._process_catalog_recursive(child) for child in children])

        # Process immediate child items
        items = catalog.get_items()
        item_count = 0
        result.clear_items()
        source = None
        for item in items:
            cloned_item = item.clone()
            # if there is a bbox, but no geometry, create a geometry from the bbox
            if cloned_item.bbox and not cloned_item.geometry:
                cloned_item.geometry = util.bbox_to_geometry(cloned_item.bbox)
            item_count = item_count + 1
            source = source or self._get_item_source(cloned_item)
            output_item = self.process_item(cloned_item, source)
            if output_item:
                # Ensure the item gets a new ID
                if output_item.id == item.id:
                    output_item.id = str(uuid.uuid4())
                result.add_item(output_item)
        self.logger.info(f'Processed {item_count} granule(s)')

        # process 'next' link if present
        link = catalog.get_single_link(rel='next')
        if link:
            next_catalog = read_file(link.get_href())
            result.add_child(self._process_catalog_recursive(next_catalog))

        return result

    def process_item(self, item, source):
        """
        Given a pystac.Item and a message.Source (collection and variables to subset), processes the
        item, returning a new pystac.Item that describes the output location and metadata

        Optional abstract method. Required if the default #invoke implementation is used.  Services
        processing one input file at a time can simplify adapter code by overriding this method.


        Parameters
        ----------
        item : pystac.Item
            the item that should be processed
        source : harmony_service_lib.message.Source
            the input source defining the variables, if any, to subset from the item

        Returns
        -------
        pystac.Item
            a STAC item whose metadata and assets describe the service output
        """
        raise NotImplementedError('subclasses must implement #process_item or override #invoke')

    def _get_item_source(self, item):
        """
        Given a STAC item, finds and returns the item's data source in this.message.  It
        specifically looks for a link with relation "harmony_source" in the item and all
        parent catalogs.  The href on that link is the source collection landing page, which
        can identify a source.  If no relation exists and there is only one source in the
        message, returns the message source.

        Parameters
        ----------
        item : pystac.Item
            the item whose source is needed

        Raises
        ------
        RuntimeError
            if no input source could be unambiguously determined, which indiciates a
            misconfiguration or bad input message

        Returns
        -------
        harmony_service_lib.message.Source
            The source of the input item
        """
        parent = item
        sources = parent.get_links('harmony_source')
        while len(sources) == 0 and parent.get_parent() is not None:
            parent = parent.get_parent()
            sources = parent.get_links('harmony_source')
        if len(sources) == 0:
            if len(self.message.sources) == 1:
                return self.message.sources[0]
            else:
                raise RuntimeError('Could not match STAC catalog to an input source')
        href = sources[0].target
        collection = href.split('/').pop()
        return next(source for source in self.message.sources if source.collection == collection)
