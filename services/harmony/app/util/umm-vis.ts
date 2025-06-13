export interface CmrUmmVisualization {
  meta: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'concept-id': string;
    associations?: {
      collections?: string[];
      variables?: string[];
    }
  };
  umm: object;
}