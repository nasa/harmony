class DataOperation {
  constructor(model = null) {

    this.model = model || {
      version: 0,
      sources: [],
      format: {},
      subset: {}
    };
  }

  get sources() {
    return this.model.sources;
  }

  addSource(collection, variables) {
    this.model.sources.push({ collection: collection, variables: variables });
  }

  get crs() {
    return this.model.format.crs;
  }

  set crs(crs) {
    this.model.format.crs = crs;
  }

  get isTransparent() {
    return this.model.format.isTransparent;
  }

  set isTransparent(isTransparent) {
    this.model.format.isTransparent = isTransparent;
  }

  get outputFormat() {
    return this.model.format.mime;
  }

  set outputFormat(mime) {
    this.model.format.mime = mime;
  }


  set outputDpi(dpi) {
    this.model.format.dpi = dpi;
  }

  set styles(styles) {
    this.model.format.styles = styles;
  }

  set noDataColor(color) {
    this.model.format.noDataColor = color;
  }

  get boundingRectangle() {
    return this.model.subset.bbox;
  }

  set boundingRectangle(bbox) {
    this.model.subset.bbox = bbox;
  }

  get temporal() {
    const temporal = this.model.temporal;
    if (!temporal) return null;
    return [temporal.start, temporal.end];
  }

  set temporal([startTime, endTime]) {
    this.model.temporal = {
      start: startTime,
      end: endTime
    }
  }

  get outputWidth() {
    return this.model.format.width;
  }

  set outputWidth(width) {
    this.model.format.width = width;
  }

  get outputHeight() {
    return this.model.format.width;
  }

  set outputHeight(height) {
    this.model.format.height = height;
  }

  serialize(version = 0) {
    return this.model;
  }
}

module.exports = DataOperation;
