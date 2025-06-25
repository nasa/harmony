"""
==========
message.py
==========

Harmony message parsing and helper objects.  Callers should generally
only construct the 'Message' object and allow its children to be built
from the message JSON.
"""

import hashlib
import json
import copy
from warnings import warn


class JsonObject(object):
    """
    Base class for deserialized Harmony message objects

    Attributes
    ----------
    data : dictionary
        The JSON data object / dictionary used to build this object

    properties: list
        A list of properties that are included in string representations
    """
    reprdepth = 0

    def __init__(self, data, properties=[], list_properties={}):
        """
        Constructor

        Parameters
        ----------
        data : dictionary
            The JSON dictionary created by json.loads at the root of this object
        properties : list, optional
            A list of properties that should be extracted to attributes, by default []
        list_properties : dict, optional
            A dictionary of property name to type for properties that are lists of
            JSONObject classes, by default {}
        """
        self.output_data = data or {}
        self.data = copy.deepcopy(data) or {}
        self.properties = properties + list(list_properties.keys())
        self.processed = []
        for prop in properties:
            setattr(self, prop, data.get(prop))
        for prop in list_properties:
            Class = list_properties[prop]
            items = data.get(prop) or []
            value = [Class(item) for item in items]
            setattr(self, prop, value)

    def __getitem__(self, key):
        """
        Retrieve the value corresponding to a key in data

        Parameters
        ----------
        key : str
            The key to retrieve the value for

        Returns
        -------
        value : object or None
            The value corresponding to the key if it exists, otherwise None
        """
        return self.data.get(key)

    def process(self, *prop):
        """
        Marks the given property as having been processed and returns its value.
        If multiple properties are passed, returns their values an array

        Parameters
        ----------
        prop : string
            the name of the property having been processed

        Returns
        -------
        object
            the value of the property supplied
        """
        result = []
        for p in prop:
            self.output_data.pop(p, None)
            result.append(getattr(self, p))
        if len(result) == 1:
            return result[0]
        return result

    def __repr__(self):
        """
        Returns
        -------
        string
            A string representation of the object
        """
        result = ''
        JsonObject.reprdepth += 1
        try:
            spaces = '    ' * JsonObject.reprdepth
            result += '<' + self.__class__.__name__ + '\n'
            result += '\n'.join(["%s%s = %s" % (spaces, p, repr(getattr(self, p)))
                                 for p in self.properties])
            result += '>'
        finally:
            JsonObject.reprdepth -= 1
        return result


class Source(JsonObject):
    """
    A collection / granule / variable / coordinateVariable / visualization data source as found in
    the Harmony message "sources" list.

    Attributes
    ----------
    collection : string
        The id of the collection the data source's variables and granules are in
    shortName : string
        The unique short name of the collection as returned by the CMR
    versionId : string
        The version id of the collection as returned by the CMR
    variables : list
        A list of Variable objects for the variables which should be transformed
    coordinateVariables: list
        A list of Variable objects containing the coordinate variables for the
        collection.
    visualizations: list
        A list of objects containing the UMM-Vis data for the collection. This list will be
        empty if the user specifies any variables for subsetting.
    granules : list
        A list of Granule objects for the granules which should be operated on
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "sources" item to deserialize
        """
        super().__init__(message_data,
                         properties=['collection', 'shortName', 'versionId'],
                         list_properties={
                             'variables': Variable,
                             'coordinateVariables': Variable,
                             'visualizations': JsonObject,
                             'granules': Granule
                            }
                         )
        for granule in self.granules:
            granule.collection = self.collection
            granule.variables = self.variables


class Variable(JsonObject):
    """
    A data variable as found in a Harmony source's "variables" list

    Attributes
    ----------
    id : string
        The UMM-Var ID of the variable.
    name : string
        The UMM-Var short name of the variable, typically identifies layer name found in the
        science data file.
    fullPath : string
         The variable's absolute path within the file, including hierarchy.  Derived from
         UMM-Var group path combined with name.
    relatedUrls : list
         A list of RelatedUrl(s) for the variable.
    visualizations: list
        A list of Umm-Vis objects for the variable.
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "variables" or "coordinateVariables" item to deserialize
        """
        super().__init__(
            message_data,
            properties=['id', 'name', 'fullPath', 'type', 'subtype'],
            list_properties={
                'relatedUrls': RelatedUrl,
                'visualizations': JsonObject
            })


class RelatedUrl(JsonObject):
    """
    A related URL describes an external resource or location on the web
    (data access location, project home page, relevant software packages, etc.)

    Attributes
    ----------
    url : string
        Points to the location of the resource described by the RelatedUrl.
    urlContentType : string
        A keyword which describes the content of a link at a high level.
    type : string
        A keyword which specifies the content of a link.
    subtype : string
        A keyword which further specifies the content of a link.
    description : string
        Explains where the link navigates and the type of information it contains.
    format : string
        The format of the data.
    mimeType : string
        The mime type of the data.
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "relatedUrls" item to deserialize
        """
        super().__init__(message_data, properties=[
            'url', 'urlContentType', 'type', 'subtype', 'description', 'format', 'mimeType']
        )


class Granule(JsonObject):
    """
    A science granule as found in a Harmony source's "granules" list

    Attributes
    ----------
    id : string
        The CMR Granule ID of the granule
    name: string
        The granule's short name
    url: string
        The URL to the granule, preferentially an S3 URL.  Potentially behind EDL
    bbox : list
        A list of 4 floating point values corresponding to [West, South, East, North]
        coordinates of the granule's spatial MBR
    temporal: Temporal
        The temporal extent of the granule
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "granules" item to deserialize
        """
        super().__init__(message_data, properties=[
            'id', 'name', 'url', 'bbox', 'temporal'])
        warn('message.Granule is deprecated.  New workflows will use STAC catalogs instead',
             DeprecationWarning, stacklevel=2)
        self.local_filename = None
        self.collection = None
        self.variables = []
        if self.temporal is not None:
            self.temporal = Temporal(message_data['temporal'])


class MinMax(JsonObject):
    """
    Min and max parameters as found in a Harmony message's "format.scaleExtent.[x|y]" objects

    Attributes
    ----------
    min: float
        The min value for the attribute
    max: float
        The max value for the attribute
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "format.scaleExtent.[x|y]" object to deserialize
        """
        super().__init__(message_data, properties=['min', 'max'])


class Dimension(JsonObject):
    """
    Dimension subset parameters as found in a single dimension from the list of the
    Harmony message's "subset.dimensions" field.

    Attributes
    ----------
    name: string
        The name of the dimension
    min: float
        The min value for the dimension
    max: float
        The max value for the dimension
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            A single dimension from the list of the Harmony message's "subset.dimensions"
            field
        """
        super().__init__(message_data, properties=['name', 'min', 'max'])


class ScaleExtent(JsonObject):
    """
    Scale extent parameters as found in a Harmony message's "format.scaleExtent" object

    Attributes
    ----------
    x: message.MinMax
        The min and max values for the scale extent for the X dimension
    y: message.MinMax
        The min and max values for the scale extent for the Y dimension
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "format.scaleExtent" object to deserialize
        """
        super().__init__(message_data, properties=['x', 'y'])
        if self.x is not None:
            self.x = MinMax(message_data['x'])
        if self.y is not None:
            self.y = MinMax(message_data['y'])


class ScaleSize(JsonObject):
    """
    Scale size parameters as found in a Harmony message's "format.scaleSize" object

    Attributes
    ----------
    x: float
        The scale size for the X dimension
    y: float
        The scale size for the Y dimension
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "format.scaleExtent" object to deserialize
        """
        super().__init__(message_data, properties=['x', 'y'])


class SRS(JsonObject):
    """
    Output CRS information as found in a Harmony message's "format.srs" object

    Attributes
    ----------
    proj4 : string
        The Proj4 representation for output CRS.
    wkt : string
        The WKT information for output CRS.
    epsg : string
        The EPSG designation, if suppplied or derived, for output CRS.
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "variables" item to deserialize
        """
        super().__init__(message_data, properties=['proj4', 'wkt', 'epsg'])


class Format(JsonObject):
    """
    Output format parameters as found in a Harmony message's "format" object

    Attributes
    ----------
    crs: string
        A proj4 string or EPSG code corresponding to the desired output projection
    srs: message.SRS
        The output CRS information; overlappting information with 'crs'
    isTransparent: boolean
        A boolean corresponding to whether or not nodata values should be set to transparent
        in the output if the file format allows it
    mime: string
        The mime type of the desired output file
    width: integer
        The pixel width of the desired output
    height: integer
        The pixel height of the desired output
    dpi: integer
        The number of pixels per inch in the desired output file, for image output formats
        that support it
    interpolation: string
        The interpolation method
    scaleExtent: message.ScaleExtent
        The scale extent in the x and y dimensions
    scaleSize: message.ScaleSize
        The scale size in the x and y dimensions
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "format" object to deserialize
        """
        super().__init__(message_data, properties=[
            'crs',
            'srs',
            'isTransparent',
            'mime',
            'width',
            'height',
            'dpi',
            'interpolation',
            'scaleExtent',
            'scaleSize'
        ])
        if self.srs is not None:
            self.srs = SRS(message_data['srs'])
        if self.scaleExtent is not None:
            self.scaleExtent = ScaleExtent(message_data['scaleExtent'])
        if self.scaleSize is not None:
            self.scaleSize = ScaleSize(message_data['scaleSize'])


class RemoteResource(JsonObject):
    """
    Remote resource

    Attributes
    ----------
    uri : string
        A string of the remote resource location
    type : string
        The resource's content type
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message remote resource object to deserialize
        """
        super().__init__(message_data, properties=['href', 'type'])


class Subset(JsonObject):
    """
    Subsetting parameters as found in a Harmony message's "subset" object

    Attributes
    ----------
    bbox : list
        A list of 4 floating point values corresponding to [West, South, East, North]
        coordinates
    point: list containing 2 floating point values corresponding to longitude and latitude
    shape: RemoteResource
        A reference to a location containing a shapefile
    dimensions: list
        A list of Dimension objects to subset against
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "subset" object to deserialize
        """
        super().__init__(message_data, properties=['bbox', 'point', 'shape', 'dimensions'])
        if self.shape is not None:
            self.shape = RemoteResource(message_data['shape'])
        if self.dimensions is not None:
            dimensions = []
            for dimension in self.dimensions:
                dimensions.append(Dimension(dimension))
            self.dimensions = dimensions


class Temporal(JsonObject):
    """
    Temporal subsetting parameters as found in a Harmony message's "temporal" object

    Attributes
    ----------
    start : string
        An ISO 8601 datetime string for the earliest time for temporal subsetting
    end : string
        An ISO 8601 datetime string for the latest time for temporal subsetting
    """

    def __init__(self, message_data=None, start=None, end=None):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary, optional
            The Harmony message "temporal" object to deserialize
        start: string, optional
            The temporal range start as RFC-3339 date/time string
        start: end, optional
            The temporal range end as RFC-3339 date/time string
        """
        super().__init__(message_data or {}, properties=['start', 'end'])
        if start is not None:
            self.start = start
        if end is not None:
            self.end = end


class ExtraArgs(JsonObject):
    """
    Extra Args parameters as found in a Harmony message's "extraArgs" object
    The value of extra args parameter can be retrieved via ['<parameter>'],
    e.g. message.extraArgs['cut'] will return the value of 'cut' parameter in extraArgs.
    """

    def __init__(self, message_data):
        """
        Constructor

        Parameters
        ----------
        message_data : dictionary
            The Harmony message "extraArgs" object to deserialize
        """
        super().__init__(message_data)


class Message(JsonObject):
    """
    Top-level object corresponding to an incoming Harmony message.  Constructing
    this with a JSON string will deserialize the message into native Python object,
    perform any necessary version interpretation, and add some helpers to make access
    easier.  Generally, this object should be created and allowed to produce its
    child objects rather than directly instantiating Subset, Format, etc objects.
    For maximum compatibility and ease of use, services should prefer using objects
    of this class and their children rather than parsing Harmony's JSON.

    Attributes
    ----------
    version : string
        The semantic version of the Harmony message contained in the provided JSON
    callback : string
        (Deprecated) The URL that services must POST to when their execution is complete.
    stagingLocation : string
        An object store (S3) URL prefix under which services may elect to put their output.
        Services must have write access to the Harmony staging bucket for the deployed
        environment to use this value.  The location will be unique per Harmony request
        but services are responsible for ensuring no name clashes occur within a single
        request.  The prefix will end in a "/" character.
    isSynchronous : bool
        True if a user is awaiting an immediate response, False if the user is expecting
        the service to be performed at a later point.  This may influence prioritization
        of the request and impacts ability to send multi-file responses
    user : string
        The username of the user requesting the service.  If the message is coming from
        Harmony, services can assume that the provided username has been authenticated
    accessToken : string
        The Earthdata Login token for the caller. If present, the token is used as the
        identity for HTTP downloads.
    client : string
        A string indicating the client accessing the service, usually the harmony
        environment, e.g. "harmony-sit"
    requestId : string
        A UUID identifying the originating user request.  This should only be used for
        logging and tracing purposes, as a single user request may produce multiple
        service invocations.
    format: message.Format
        The Harmony message's output parameters
    subset: message.Subset
        The Harmony message's subsetting parameters
    temporal: message.Temporal
        The Harmony message's temporal subsetting parameters
    concatenate: bool
        True if the service should concatenate multiple input files into a single output
        file and false otherwise.
    average: string
        The averaging method to use
    extendDimensions: list
        A list of dimensions to extend.
    pixelSubset : bool
        True if pixel subset should be performed by the service.
    extraArgs: object
        A map of key (string type) and value (any type) pairs indicating the extra arguments
        that should be passed to the worker command
    """

    def __init__(self, json_str_or_dict, decrypter=lambda x: x):
        """
        Builds a Message object and all of its child objects by deserializing the
        provided JSON string and performing any necessary version interpretation.

        Parameters
        ----------
        json_str_or_dict : string | Object
            The incoming Harmony message as a JSON string or dict as parsed by `json.load()`
        decrypter : function
            A function that takes an encrypted value and returns it decrypted
        """

        if isinstance(json_str_or_dict, str):
            json_obj = json.loads(json_str_or_dict)
        else:
            json_obj = copy.deepcopy(json_str_or_dict)

        super().__init__(
            json_obj,
            properties=[
                'version',
                'callback',
                'stagingLocation',
                'isSynchronous',
                'user',
                'accessToken',
                'client',
                'requestId',
                'format',
                'subset',
                'temporal',
                'concatenate',
                'average',
                'extendDimensions',
                'pixelSubset',
                'extraArgs'
            ],
            list_properties={'sources': Source}
        )

        self.decrypter = decrypter

        if self.format is not None:
            self.format = Format(json_obj['format'])
        if self.subset is not None:
            self.subset = Subset(json_obj['subset'])
        if self.temporal is not None:
            self.temporal = Temporal(json_obj['temporal'])
        if self.accessToken is not None:
            self.accessToken = self.decrypter(self.accessToken)
        if self.extraArgs is not None:
            self.extraArgs = ExtraArgs(json_obj['extraArgs'])

    @property
    def json(self):
        return json.dumps(self.output_data)

    def digest(self):
        """
        Returns a shasum of the message, useful in providing unique output IDs

        Returns
        -------
        string
            The shasum of the message
        """
        return hashlib.sha256(self.json.encode('utf-8')).hexdigest()

    @property
    def granules(self):
        """
        A list of all the granules in all of the data sources.  Each granule
        links back to its source collection and requested variables, so it
        can be more convenient to use this granules list than to traverse
        the data sources themselves if services process granules individually

        Returns
        -------
        list
            A list of Granule objects for all of the granules in the message
        """
        result = []
        for source in self.sources:
            result += source.granules
        return result
