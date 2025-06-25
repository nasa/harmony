"""Utilities for acting on Harmony Messages.

These are a collection of useful routines for validation and interrogation of
harmony_service_lib Messages.
"""

from typing import Any, List

from harmony_service_lib.message import Message


def has_self_consistent_grid(message: Message, allow_incomplete_grid: bool = False) -> bool:
    """Check the input Harmony message defines a self-consistent grid.

    At minimum a self-consistent grid should define the scale extents
    (minimum and maximum values) in the horizontal spatial dimensions and
    one of the following two pieces of information:

        * Message.format.scaleSize - defining the x and y pixel size.
        * Message.format.height and Message.format.width - the number of pixels
          in the x and y dimension.

    If all three pieces of information are supplied, they will be checked to
    ensure they are consistent with one another.

    If scaleExtent and scaleSize are defined, along with only one of height or
    width, the grid will be considered consistent if the three values for
    scaleExtent, scaleSize and specified dimension length, height or width, are
    consistent.

    If no grid parameters are provided, or only one of the three are defined,
    then the function will return the value of `allow_incomplete_grid`, as there is
    insufficient information to determine if the grid is self-consistent.

    Parameters
    ----------
        message : harmony_service_lib.message.Message
            The Harmony message object provided to a service for a request.
        allow_incomplete_grid : bool, optional
            Optional parameter stating whether the validation check should pass
            if the message does not contain any grid parameters. Applicable to
            instances when only a target projection is specified in a request,
            with the expectation that the target grid will cover the horizontal
            spatial area of the input granule. Default value is `False`.

    Returns
    -------
        bool
            Value indicating if the Harmony message parameters met the criteria
            for grid self-consistency. If there are no grid parameters, or only
            one of scaleExtents, scaleSize or height/width are provided, then
            the return value is determined by `allow_incomplete_grid`, which
            defaults to `False`.

    """
    if (
        has_scale_extents(message) and has_scale_sizes(message)
        and has_dimensions(message)
    ):
        consistent_grid = (_has_consistent_dimension(message, 'x')
                           and _has_consistent_dimension(message, 'y'))
    elif (
        has_scale_extents(message) and has_scale_sizes(message)
        and rgetattr(message, 'format.height') is not None
    ):
        consistent_grid = _has_consistent_dimension(message, 'y')
    elif (
        has_scale_extents(message) and has_scale_sizes(message)
        and rgetattr(message, 'format.width') is not None
    ):
        consistent_grid = _has_consistent_dimension(message, 'x')
    elif (
        has_scale_extents(message)
        and (has_scale_sizes(message) or has_dimensions(message))
    ):
        consistent_grid = True
    else:
        consistent_grid = allow_incomplete_grid

    return consistent_grid


def has_dimensions(message: Message) -> bool:
    """ Ensure the supplied Harmony message contains values for height and
        width of the target grid, which define the sizes of the x and y
        horizontal spatial dimensions.

    """
    return _has_all_attributes(message, ['format.height', 'format.width'])


def has_crs(message: Message) -> bool:
    """Returns true if Harmony message contains a crs."""
    target_crs = rgetattr(message, 'format.crs')
    return target_crs is not None


def has_scale_extents(message: Message) -> bool:
    """ Ensure the supplied Harmony message contains values for the minimum and
        maximum extents of the target grid in both the x and y dimensions.

    """
    scale_extent_attributes = ['format.scaleExtent.x.min',
                               'format.scaleExtent.x.max',
                               'format.scaleExtent.y.min',
                               'format.scaleExtent.y.max']

    return _has_all_attributes(message, scale_extent_attributes)


def has_scale_sizes(message: Message) -> bool:
    """ Ensure the supplied Harmony message contains values for the x and y
        horizontal scale sizes for the target grid.

    """
    scale_size_attributes = ['format.scaleSize.x', 'format.scaleSize.y']
    return _has_all_attributes(message, scale_size_attributes)


def has_valid_scale_extents(message: Message) -> bool:
    """Ensure any input scale_extents are valid."""
    if has_scale_extents(message):
        return (
            float(rgetattr(message, 'format.scaleExtent.x.min'))
            < float(rgetattr(message, 'format.scaleExtent.x.max'))
        ) and (
            float(rgetattr(message, 'format.scaleExtent.y.min'))
            < float(rgetattr(message, 'format.scaleExtent.y.max'))
        )
    return True


def _has_all_attributes(message: Message, attributes: List[str]) -> bool:
    """ Ensure that the supplied Harmony message has non-None attribute values
        for all the listed attributes.

    """
    return all(rgetattr(message, attribute_name) is not None
               for attribute_name in attributes)


def _has_consistent_dimension(message: Message, dimension_name: str) -> bool:
    """ Ensure a grid dimension has consistent values for the scale extent
        (e.g., minimum and maximum values), scale size (resolution) and
        dimension length (e.g., width or height). For the grid x dimension, the
        calculation is as follows:

        scaleSize.x = (scaleExtent.x.max - scaleExtent.x.min) / (width)

        The message scale sizes is compared to that calculated as above, to
        ensure it is within a relative tolerance (1 x 10^-3).

    """
    message_scale_size = getattr(message.format.scaleSize, dimension_name)
    scale_extent = getattr(message.format.scaleExtent, dimension_name)

    if dimension_name == 'x':
        dimension_elements = message.format.width
    else:
        dimension_elements = message.format.height

    derived_scale_size = (scale_extent.max - scale_extent.min) / dimension_elements

    return abs(message_scale_size - derived_scale_size) <= 1e-3


def rgetattr(input_object: Any, requested_attribute: str, *args) -> Any:
    """ This is a recursive version of the inbuilt `getattr` method, such that
        it can be called to retrieve nested attributes. For example:
        the Message.subset.shape within the input Harmony message.

        Note, if a default value is specified, this will be returned if any
        attribute in the specified chain is absent from the supplied object.
        Alternatively, if an absent attribute is specified and no default value
        if given in the function call, this function will return `None`.

    """
    if len(args) == 0:
        args = (None, )

    if '.' not in requested_attribute:
        result = getattr(input_object, requested_attribute, *args)
    else:
        attribute_pieces = requested_attribute.split('.')
        result = rgetattr(getattr(input_object, attribute_pieces[0], *args),
                          '.'.join(attribute_pieces[1:]), *args)

    return result
