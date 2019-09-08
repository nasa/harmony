class DataOperation {
  constructor(model = null) {
    this.model = model || {
      sources: [],
      format: {},
      subset: {},
    };
  }

  get sources() {
    return this.model.sources;
  }

  addSource(collection, variables) {
    this.model.sources.push({ collection, variables });
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
    const { temporal } = this.model;
    if (!temporal) return null;
    return [temporal.start, temporal.end];
  }

  set temporal([startTime, endTime]) {
    this.model.temporal = {
      start: startTime,
      end: endTime,
    };
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

  get callback() {
    return this.model.callback;
  }

  set callback(value) {
    this.model.callback = value;
  }

  serialize(version = 0) {
    return JSON.stringify(Object.assign(this.model, { version }));
  }
}

module.exports = DataOperation;
