import Record from './record';

interface JobLinkRecord {
  id?: number;
  jobID?: string;
  href: string;
  type?: string;
  title?: string;
  rel?: string;
  temporalStart?: Date | number;
  temporalEnd?: Date | number;
  bbox?: string | number[];
  createdAt?: Date | number;
  updatedAt?: Date | number;
}

/**
 *
 * Wrapper object for persisted job links
 *
 */
export default class JobLink extends Record {
  static table = 'job_links';

  jobID: string;

  href: string;

  type?: string;

  title?: string;

  rel?: string;

  temporalStart?: Date | number;

  temporalEnd?: Date | number;

  bbox?: string | number[];

  /**
   * Creates a Job link from the links in a job.
   *
   * @param fields - Object containing fields to set on the record
   */
  constructor(fields: JobLinkRecord) {
    super(fields);
    if (fields.bbox && typeof fields.bbox !== 'string') {
      this.bbox = fields.bbox.join(',');
    }
  }
}

/**
 * Returns the links for a given job
 * @param transaction - the transaction to use for querying
 * @param jobID - the UUID associated with the job
 */
export async function getLinksForJob(transaction, jobID): Promise<JobLink[]> {
  const links = await transaction('job_links').select().where({ jobID }).forUpdate();
  return links.map((j) => new JobLink(j));
}
