import { expect } from 'chai';
import { describe, it } from 'mocha';

import { truncateAll } from '../../../../packages/util/test/helpers/db';
import {
  bucketCount, chooseBucketMs, estimatePercentile, getServiceTotals, getStatusSeries, MS_PER_DAY,
  MS_PER_HOUR, MS_PER_MINUTE, previousRange, resolveRange, withMaxBuckets,
} from '../../app/models/dashboard-stats';
import db from '../../app/util/db';
import { RequestValidationError } from '../../app/util/errors';

const NOW = new Date('2026-10-27T15:42:30.000Z');

describe('resolveRange', function () {
  describe('with a preset of a day or less', function () {
    const range = resolveRange({ preset: '6h' }, NOW, 14);

    it('reads per-minute stats', function () {
      expect(range.granularity).to.equal('minute');
    });

    it('ends at the start of the current minute, so only complete minutes are included', function () {
      expect(range.end.toISOString()).to.equal('2026-10-27T15:42:00.000Z');
      expect(range.start.toISOString()).to.equal('2026-10-27T09:42:00.000Z');
    });

    it('divides the range into at most 120 buckets', function () {
      expect(range.bucketMs).to.equal(5 * MS_PER_MINUTE);
      expect(bucketCount(range)).to.equal(72);
    });
  });

  describe('with a preset longer than a day', function () {
    const range = resolveRange({ preset: '7d' }, NOW, 14);

    it('reads the hourly rollups', function () {
      expect(range.granularity).to.equal('hour');
    });

    it('ends at the end of the current hour, so the in-progress hour is included', function () {
      expect(range.end.toISOString()).to.equal('2026-10-27T16:00:00.000Z');
      expect(range.end.getTime() - range.start.getTime()).to.equal(7 * MS_PER_DAY);
    });

    it('uses buckets no smaller than an hour', function () {
      expect(range.bucketMs).to.equal(2 * MS_PER_HOUR);
    });
  });

  describe('with a custom range', function () {
    it('widens it to whole minutes when reading per-minute stats', function () {
      const range = resolveRange({
        start: new Date('2026-10-27T10:00:20Z'), end: new Date('2026-10-27T11:30:10Z'),
      }, NOW, 14);
      expect(range.granularity).to.equal('minute');
      expect(range.start.toISOString()).to.equal('2026-10-27T10:00:00.000Z');
      expect(range.end.toISOString()).to.equal('2026-10-27T11:31:00.000Z');
    });

    it('reads the hourly rollups when it starts before per-minute stats are kept', function () {
      const range = resolveRange({
        start: new Date('2026-09-01T10:15:00Z'), end: new Date('2026-09-01T12:15:00Z'),
      }, NOW, 14);
      expect(range.granularity).to.equal('hour');
      expect(range.start.toISOString()).to.equal('2026-09-01T10:00:00.000Z');
      expect(range.end.toISOString()).to.equal('2026-09-01T13:00:00.000Z');
    });

    it('rejects a start after the end', function () {
      expect(() => resolveRange({ start: NOW, end: new Date(NOW.getTime() - 1) }, NOW, 14))
        .to.throw(RequestValidationError, 'start must be earlier than end');
    });

    it('rejects a range longer than 400 days', function () {
      expect(() => resolveRange({ start: new Date(NOW.getTime() - 401 * MS_PER_DAY), end: NOW }, NOW, 14))
        .to.throw(RequestValidationError, 'at most 400 days');
    });
  });

  it('rejects an unknown preset', function () {
    expect(() => resolveRange({ preset: '2w' }, NOW, 14)).to.throw(RequestValidationError, 'range must be one of');
  });
});

describe('previousRange', function () {
  it('is the range of the same length immediately before', function () {
    const range = resolveRange({ preset: '1h' }, NOW, 14);
    const previous = previousRange(range, NOW, 14);
    expect(previous.end).to.eql(range.start);
    expect(previous.start.toISOString()).to.equal('2026-10-27T13:42:00.000Z');
    expect(previous.granularity).to.equal('minute');
    expect(previous.bucketMs).to.equal(range.bucketMs);
  });

  it('stays hourly for an hourly range', function () {
    const range = resolveRange({ preset: '30d' }, NOW, 14);
    const previous = previousRange(range, NOW, 14);
    expect(previous.granularity).to.equal('hour');
    expect(previous.end).to.eql(range.start);
    expect(previous.end.getTime() - previous.start.getTime()).to.equal(30 * MS_PER_DAY);
  });

  describe('for a per-minute range whose previous range starts before the per-minute retention period', function () {
    const range = resolveRange({
      start: new Date('2026-10-13T20:20:00.000Z'), end: new Date('2026-10-14T08:20:00.000Z'),
    }, NOW, 14);
    const previous = previousRange(range, NOW, 14);

    it('reads the hourly rollups', function () {
      expect(range.granularity).to.equal('minute');
      expect(previous.granularity).to.equal('hour');
    });

    it('is widened to whole hours', function () {
      expect(previous.start.toISOString()).to.equal('2026-10-13T08:00:00.000Z');
      expect(previous.end.toISOString()).to.equal('2026-10-13T21:00:00.000Z');
      expect(previous.bucketMs % MS_PER_HOUR).to.equal(0);
    });
  });
});

describe('chooseBucketMs', function () {
  it('uses the smallest bucket that fits within the maximum number of buckets', function () {
    expect(chooseBucketMs(MS_PER_HOUR, 'minute', 120)).to.equal(MS_PER_MINUTE);
    expect(chooseBucketMs(MS_PER_DAY, 'minute', 120)).to.equal(15 * MS_PER_MINUTE);
    expect(chooseBucketMs(MS_PER_DAY, 'minute', 24)).to.equal(MS_PER_HOUR);
    expect(chooseBucketMs(90 * MS_PER_DAY, 'hour', 120)).to.equal(MS_PER_DAY);
  });

  it('never uses a bucket smaller than the granularity', function () {
    expect(chooseBucketMs(2 * MS_PER_HOUR, 'hour', 120)).to.equal(MS_PER_HOUR);
  });

  it('is used to coarsen sparklines', function () {
    expect(withMaxBuckets(resolveRange({ preset: '24h' }, NOW, 14), 24).bucketMs).to.equal(MS_PER_HOUR);
  });
});

describe('estimatePercentile', function () {
  it('returns null for an empty histogram', function () {
    expect(estimatePercentile([0, 0, 0, 0, 0, 0, 0, 0], 0, 0.5)).to.be.null;
  });

  it('interpolates within the bucket the percentile falls in', function () {
    // 10 work items under 1s, 10 from 1-5s: the median is the top of the first bucket
    expect(estimatePercentile([10, 10, 0, 0, 0, 0, 0, 0], 4000, 0.5)).to.equal(1000);
    // the 75th percentile is halfway through the second bucket, capped at the maximum
    expect(estimatePercentile([10, 10, 0, 0, 0, 0, 0, 0], 5000, 0.75)).to.equal(3000);
  });

  it('never exceeds the maximum duration', function () {
    expect(estimatePercentile([0, 10, 0, 0, 0, 0, 0, 0], 2000, 0.95)).to.equal(1950);
    expect(estimatePercentile([0, 10, 0, 0, 0, 0, 0, 0], 1200, 0.95)).to.equal(1190);
  });

  it('assumes the open ended last bucket ends at the maximum', function () {
    expect(estimatePercentile([0, 0, 0, 0, 0, 0, 0, 10], 2 * MS_PER_HOUR, 0.5)).to.equal(1.5 * MS_PER_HOUR);
  });
});

describe('dashboard stats queries', function () {
  const range = resolveRange({ preset: '1h' }, NOW, 14);
  const minuteAt = (minutes: number): Date => new Date(range.start.getTime() + minutes * MS_PER_MINUTE);
  const row = (minute: Date, status: string, count: number, durationBucket0 = 0): Record<string, unknown> => ({
    minute, service_id: 'svc:1', status, count, duration_count: durationBucket0, sum_duration_ms: durationBucket0 * 100,
    max_duration_ms: durationBucket0 ? 100 : 0, duration_bucket_0: durationBucket0,
  });

  before(async function () {
    await truncateAll();
    await db('work_items_stats').insert([
      row(minuteAt(0), 'successful', 3, 3),
      row(minuteAt(1), 'successful', 2, 2),
      row(minuteAt(59), 'failed', 1),
      // just outside the range on either side
      row(new Date(range.start.getTime() - MS_PER_MINUTE), 'successful', 100, 100),
      row(range.end, 'successful', 100, 100),
    ]);
  });
  after(truncateAll);

  it('totals the rows within the range by service and status', async function () {
    const totals = await getServiceTotals(db, range);
    const byStatus = Object.fromEntries(totals.map((t) => [t.status, t]));
    expect(byStatus.successful.count).to.equal(5);
    expect(byStatus.successful.sum_duration_ms).to.equal(500);
    expect(byStatus.successful.buckets).to.eql([5, 0, 0, 0, 0, 0, 0, 0]);
    expect(byStatus.failed.count).to.equal(1);
  });

  it('assigns each row to the time series bucket it falls in', async function () {
    const series = await getStatusSeries(db, range);
    expect(series.map((s) => [s.bucket, s.status, s.count]).sort()).to.eql([
      [0, 'successful', 3], [1, 'successful', 2], [59, 'failed', 1],
    ]);
  });
});
