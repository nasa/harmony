def clip_bbox(dataset_bounds, bbox):
    """
    Clips the bbox so it is no larger than the dataset bounds.

    Parameters
    ----------
        dataset_bounds: list of lon / lat bounds. E.g., [[-108, -104], [40, 42]]
            represents the extent bounded by:
              * -108 deg longitude on the west
              * -104 deg longitude on the east
              * 40 deg latitude on the south
              * 42 deg latitude on the north
        bbox: a list of bounding box corner coordinates. E.g., [86, 28, 87, 29]
              represents the box defined by a *lower-left* point at 86 deg longitude,
              28 deg latitude, and an *upper-right* point at 87 deg longitude,
              29 deg latitude.

    Returns
    -------
        A list of bounding boxes that are clipped to be no larger than the
        dataset_bounds. The list may be empty if the bbox doesn't intersect
        with the dataset_bounds. The list may contain more than one bbox if,
        for example, the intersection crosses the antemeridian. In that case,
        the list will contain two bboxes that meet at the antemeridian.
    """
    bbox_bounds = [[bbox[0], bbox[2]], [bbox[1], bbox[3]]]

    x_intersections = latlon_intersection(dataset_bounds[0], bbox_bounds[0])
    y_intersections = latlon_intersection(dataset_bounds[1], bbox_bounds[1])

    if len(x_intersections) == 0 or len(y_intersections) == 0:
        return []

    return [[xi[0], yi[0], xi[1], yi[1]]
            for xi in x_intersections for yi in y_intersections]


def latlon_intersection(x, y):
    """
    Given a pair of latitude or longitude ranges, return their intersection,
    while also handling 'wraparound' at the antemeridian.

    Parameters
    ----------
        x, y: Each is a list of two coordinate values designating a min-max
            range for a coordinate. E.g., [-45, 45] represents the range of
            a longitude or latitude between -45 and 45 deg.

    Returns
    -------
        A list of coordinate ranges representing the intersection between
        x and y. The list may be empty if the ranges x & y do not intersect.
        The list may contain more than one range if the x, y intersection
        crosses the antemeridian (-180). In that case, the list will
        contain two ranges that meet at the antemeridian.

    """
    def expand(a):
        """
        Split a range into two if it wraps the antemeridian. E.g., the
        range [170, -170] will be split into [[170, 180], [-180, -170]].
        Otherwise it returns a list containing the range, e.g., [[-30, 30]].
        """
        if a[1] < a[0]:
            return [[a[0], 180.0], [-180.0, a[1]]]
        else:
            return [a]

    intersections = [_range_intersection(a, b) for a in expand(x) for b in expand(y)]
    return [i for i in intersections if i]


def _range_intersection(a, b):
    """
    Returns the range where the two given ranges intersect.

    Parameters
    ----------
        a, b: Each is a list of two coordinate values designating a min-max
            range.

    Returns
    -------
        A range (a list of two numbers) where the two given ranges intersect,
        or an empty list if they do not. E.g., a = [0, 10], b = [5, 15] will
        return [5, 10].
    """
    if (b[0] <= a[0] <= b[1]) or \
       (b[0] <= a[1] <= b[1]) or \
       (a[0] <= b[0] <= a[1]) or \
       (a[0] <= b[1] <= a[1]):
        return [max(a[0], b[0]), min(a[1], b[1])]
    else:
        return []
