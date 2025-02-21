import { Context } from '../util/context';

export abstract class CronJob {
  static async run(_ctx: Context): Promise<void> {
    throw new Error('Method not implemented! Use derived class');
  }
}