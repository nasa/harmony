# Harmony Data Operation Schemas

## Schema update checklist

- [ ] Add `<version>/data-operation-v<version>.json` to this directory, making necessary changes
- [ ] Update [CHANGELOG.md](CHANGELOG.md)
- [ ] Add a migration to [data-operation.ts](../../models/data-operation.ts)
- [ ] Add getters, setters, and any other necessary logic to to [DataOperation](../../models/data-operation.ts)
- [ ] Update the CURRENT_SCHEMA_VERSION in [DataOperation](../../models/data-operation.ts)
- [ ] Add the new version to the versions constant in [test/helpers/data-operation.ts](../../../test/helpers/data-operation.ts). Make sure the new version is the first version in the array.
- [ ] Update [test/resources/data-operation-samples/valid-operation-input.json](../../../test/resources/data-operation-samples/valid-operation-input.json) to reference the updated schema and have any new or required fields
- [ ] Update [test/models/data-operation.ts](../../../test/models/data-operation.ts) if there are any new tests to add based on changes to the data operation
- [ ] Add a new example for the new schema to [test/resources/data-operation-samples](../../../test/resources/data-operation-samples)
- [ ] Update all of the batch<n>-operation.json files in [test/resources/data-operation-samples](../../../test/resources/data-operation-samples)
- [ ] Update [test/resources/data-operation-samples/multiple-collections-operation.json](../../../test/resources/data-operation-samples/multiple-collections-operation.json)
- [ ] Update [example/service-operation.json](../../../example/service-operation.json) to reference the updated schema and have any required fields
- [ ] Update [harmony-service-lib-py](../../../../../../harmony-service-lib-py/harmony_service_lib/message.py) to parse the new schema
- [ ] Update [harmony-service-lib-py/tests/example_messages.py](../../../../../../harmony-service-lib-py/tests/example_messages.py) to use the new schema
- [ ] Update [harmony-service-lib-py/tests/test_message.py](../../../../../../harmony-service-lib-py/tests/test_message.py) to use the new schema version and add / alter any necessary checks
- [ ] Update [harmony-service-lib-py/example/example_message.json](../../../../../../harmony-service-lib-py/example/example_message.json) to use the new schema
- [ ] Update [harmony-service-example/example/harmony-operation.json](../../../../../../harmony-service-example/example/harmony-operation.json) to use the new schema
- [ ] Update [config/services.yml](../../../../../config/services.yml) to supply the new library version for any services that will be automatically or manually upgraded with the change
- [ ] Update [docs/adapting-new-services.md](../../../../../docs/guides/adapting-new-services.md) to specify the updated version
- [ ] Update any Harmony-owned services that need to use the new features or may be incompatible with the change
- [ ] Notify service authors that the schema was updated
- [ ] Swear that next time around you'll make the process a little easier
