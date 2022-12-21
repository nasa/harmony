import UserWork, { populateUserWorkFromWorkItems } from '../../app/models/user-work';
import db from '../../app/util/db';

/**
 * Adds before / after hooks to populate the user_work table in the database from the
 * entries in the work_items table.
 */
export function hookPopulateUserWorkFromWorkItems(): void {
  before(async function () {
    await populateUserWorkFromWorkItems(db);
  });
  after(async function () {
    await db(UserWork.table).truncate();
  });

}
