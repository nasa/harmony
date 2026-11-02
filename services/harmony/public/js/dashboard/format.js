// Formatting helpers for the admin dashboard. All times are shown in the viewer's local time zone.

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const groupedFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Formats a count with thousands separators, e.g. 1,284
 * @param {number} value - the count
 * @returns {string} the formatted count
 */
export function formatCount(value) {
  return groupedFormat.format(Math.round(value));
}

/**
 * Formats a count compactly from 10,000 up, e.g. 1,284 / 12.9K / 4.2M
 * @param {number} value - the count
 * @returns {string} the formatted count
 */
export function formatCompact(value) {
  return Math.abs(value) < 10000 ? formatCount(value) : compactFormat.format(value);
}

/**
 * Formats a rate (e.g. work items per minute) with sensible precision
 * @param {number} value - the rate
 * @returns {string} the formatted rate
 */
export function formatRate(value) {
  if (value === 0) return '0';
  if (value < 1) return value.toFixed(2);
  if (value < 10) return value.toFixed(1);
  return formatCompact(value);
}

/**
 * Formats a duration in milliseconds, e.g. 850 ms, 12.3 s, 4.2 min, 1.6 h, 2.1 d
 * @param {number | null | undefined} ms - the duration
 * @returns {string} the formatted duration, or an em dash if there is none
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  // one decimal place for small values, without a trailing .0 (5 min, not 5.0 min)
  const fixed = (value, digits) => value.toFixed(digits).replace(/\.0$/, '');
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < MINUTE) return `${fixed(ms / 1000, ms < 10000 ? 1 : 0)} s`;
  if (ms < HOUR) return `${fixed(ms / MINUTE, ms < 10 * MINUTE ? 1 : 0)} min`;
  if (ms < DAY) return `${fixed(ms / HOUR, 1)} h`;
  return `${fixed(ms / DAY, 1)} d`;
}

/**
 * Formats an amount of compute time (summed work item durations), e.g. 3.2 h
 * @param {number} ms - the compute time
 * @returns {string} the formatted compute time
 */
export function formatComputeTime(ms) {
  return ms > 0 ? formatDuration(ms) : '0';
}

/**
 * Formats a size in megabytes, e.g. 512 MB, 3.4 GB, 1.2 TB
 * @param {number} mb - the size
 * @returns {string} the formatted size
 */
export function formatSize(mb) {
  if (!mb) return '0';
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  if (mb < 1024 * 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${(mb / 1024 / 1024).toFixed(1)} TB`;
}

/**
 * Formats a rate between 0 and 1 as a percentage, e.g. 99.5%
 * @param {number | null | undefined} rate - the rate
 * @param {number} digits - the number of decimal places
 * @returns {string} the formatted percentage, or an em dash if there is none
 */
export function formatPercent(rate, digits = 1) {
  if (rate === null || rate === undefined) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

/**
 * Formats a time for an axis tick or tooltip, with more detail for shorter ranges
 * @param {Date} date - the time
 * @param {number} spanMs - the length of the range being shown
 * @returns {string} the formatted time
 */
export function formatTimeLabel(date, spanMs) {
  if (spanMs <= DAY) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (spanMs <= 8 * DAY) {
    return date.toLocaleString([], { weekday: 'short', hour: 'numeric' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Formats a time with its date, e.g. Oct 27, 3:04 PM
 * @param {Date} date - the time
 * @returns {string} the formatted time
 */
export function formatDateTime(date) {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Formats a time range, e.g. Oct 26, 3:00 PM – Oct 27, 3:00 PM
 * @param {Date} start - the start of the range
 * @param {Date} end - the end of the range
 * @returns {string} the formatted range
 */
export function formatRange(start, end) {
  return `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/**
 * Formats how long ago something happened, e.g. 12s ago, 4 min ago
 * @param {number} ms - how long ago
 * @returns {string} the formatted time
 */
export function formatAgo(ms) {
  if (ms < MINUTE) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  return `${formatDuration(ms)} ago`;
}

/**
 * Describes the length of a time range, e.g. 24 hours, 7 days
 * @param {number} spanMs - the length of the range
 * @returns {string} the description
 */
export function describeSpan(spanMs) {
  if (spanMs < HOUR) return `${Math.round(spanMs / MINUTE)} minutes`;
  if (spanMs < 2 * DAY) {
    const hours = Math.round(spanMs / HOUR);
    return hours === 1 ? 'hour' : `${hours} hours`;
  }
  return `${Math.round(spanMs / DAY)} days`;
}

/**
 * Describes the size of a time series bucket, e.g. minute, 5 minutes, hour, day
 * @param {number} bucketMs - the bucket size
 * @returns {string} the description
 */
export function describeBucket(bucketMs) {
  if (bucketMs === MINUTE) return 'minute';
  if (bucketMs < HOUR) return `${Math.round(bucketMs / MINUTE)} minutes`;
  if (bucketMs === HOUR) return 'hour';
  if (bucketMs < DAY) return `${Math.round(bucketMs / HOUR)} hours`;
  if (bucketMs === DAY) return 'day';
  if (bucketMs === 7 * DAY) return 'week';
  return `${Math.round(bucketMs / DAY)} days`;
}
