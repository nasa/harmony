module.exports = function getRequirementsClasses(req, res) {
  res.json({
    conformsTo: [
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/core',
      'http://www.opengis.net/spec/ogcapi-common-1/1.0/conf/collections',
      'http://www.opengis.net/spec/ogcapi-coverages-1/1.0/conf/core',
    ],
  });
};
