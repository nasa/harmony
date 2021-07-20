exports.up = async function(knex) {
  await knex.schema.alterTable("jobs", async (t) => {
    t.text("collectionIds").nullable();
  });

  await knex.raw(`UPDATE "jobs" SET "collectionIds" = "${JSON.stringify([])}"`);

  await knex.schema.alterTable("jobs", async (t) => {
    t.text("collectionIds").notNullable();
  });
}

exports.down = async function(knex) {
  await knex.schema.alterTable("jobs", async (t) => {
    t.dropColumn("collectionIds");
  });
}