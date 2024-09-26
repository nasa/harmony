--- This file contains the commands to create a database from scratch

CREATE TABLE `jobs` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `requestId` char(36) not null,
  `username` varchar(255) not null,
  `status` text check (`status` in ('accepted', 'running', 'running_with_errors', 'successful', 'failed', 'canceled', 'paused', 'previewing', 'complete_with_errors')) not null,
  `message` varchar(4096) not null,
  `progress` integer not null,
  `batchesCompleted` integer not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  `request` varchar(4096) not null default 'unknown',
  `isAsync` boolean,
  `numInputGranules` integer not null default 0,
  `collectionIds` text not null,
  `ignoreErrors` boolean not null,
  `destination_url` varchar(8192),
  `service_name` varchar(255),
  `provider_id` varchar(255)
);

CREATE TABLE `job_links` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `href` varchar(4096) not null,
  `type` varchar(255),
  `title` varchar(255),
  `rel` varchar(255),
  `temporalStart` datetime,
  `temporalEnd` datetime,
  `bbox` varchar(255),
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID) REFERENCES jobs(jobID)
);

CREATE TABLE `job_errors` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `url` varchar(4096) not null,
  `message` varchar(4096) not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID) REFERENCES jobs(jobID)
);

CREATE TABLE `user_labels` (
  `id` integer not null primary key autoincrement,
  `username` varchar(255) not null,
  `value` varchar(255) not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  UNIQUE(username, value)
);

CREATE TABLE `labels` (
  `id` integer not null primary key autoincrement,
  `job_id` char(36) not null,
  `user_label_id` integer not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(user_label_id) REFERENCES user_labels(id)
  FOREIGN KEY(job_id) REFERENCES jobs(jobID)
);

CREATE TABLE `work_items` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `workflowStepIndex` integer not null,
  `scrollID` varchar(4096),
  `serviceID` varchar(255) not null,
  `status` text check (`status` in ('ready', 'queued', 'running', 'successful', 'failed', 'canceled')) not null,
  `stacCatalogLocation` varchar(255),
  `totalItemsSize` double precision not null default 0,
  `outputItemSizesJson` text,
  `retryCount` integer not null default 0,
  `duration` float not null default -1.0,
  `sortIndex` integer not null default 0,
  `startedAt` datetime,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID) REFERENCES jobs(jobID)
  FOREIGN KEY(jobID, workflowStepIndex) REFERENCES workflow_steps(jobID, stepIndex)
);

CREATE TABLE `workflow_steps` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `serviceID` varchar(255) not null,
  `stepIndex` integer not null,
  `workItemCount` integer not null,
  `hasAggregatedOutput` boolean not null default false,
  `isBatched` boolean not null default false,
  `is_complete` boolean not null default false,
  `is_sequential` boolean not null default false,
  `maxBatchInputs` integer,
  `maxBatchSizeInBytes` integer,
  `operation` text not null,
  `completed_work_item_count` integer not null default 0,
  `progress_weight` float not null default 1.0,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID) REFERENCES jobs(jobID),
  UNIQUE(jobID, stepIndex)
);

CREATE TABLE `batches` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `serviceID` varchar(255) not null,
  `batchID` integer not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID, serviceID) REFERENCES workflow_steps(jobID, serviceID)
);

CREATE TABLE `batch_items` (
  `id` integer not null primary key autoincrement,
  `jobID` char(36) not null,
  `serviceID` varchar(255) not null,
  `batchID` integer,
  `stacItemUrl` char(4096),
  `itemSize` double precision not null default 0,
  `sortIndex` integer not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(jobID, serviceID) REFERENCES workflow_steps(jobID, serviceID)
);

CREATE TABLE `user_work` (
  `id` integer not null primary key autoincrement,
  `username` varchar(255) not null,
  `service_id` varchar(255) not null,
  `ready_count` integer not null default 0,
  `running_count` integer not null default 0,
  `job_id` char(36) not null,
  `is_async` boolean,
  `last_worked` datetime not null,
  `createdAt` datetime not null,
  `updatedAt` datetime not null,
  FOREIGN KEY(job_id) REFERENCES jobs(jobID),
  UNIQUE(job_id, service_id)
);

CREATE TABLE `service_deployment` (
  `enabled` boolean,
  `message` varchar(4096),
  `updatedAt` datetime not null
);

INSERT INTO service_deployment (enabled, message, updatedAt) VALUES (true, '', CURRENT_TIMESTAMP);

CREATE TABLE `service_deployments` (
  `id` integer not null primary key autoincrement,
  `deployment_id` char(36) not null,
  `username` varchar(255) not null,
  `service` varchar(255) not null,
  `tag` varchar(255) not null,
  `regression_test_version` varchar(255),
  `status` text check (`status` in ('running', 'successful', 'failed')) not null,
  `message` varchar(4096),
  `createdAt` datetime not null,
  `updatedAt` datetime not null
);

-- Note this is not a full list of the indices, we rely on the database migrations to create
-- all the indexes in Postgres
CREATE INDEX jobs_jobID_idx ON jobs(jobID);
CREATE INDEX jobs_updatedAt_id ON jobs(updatedAt);
CREATE INDEX jobs_status_idx ON jobs(status);
CREATE INDEX jobs_username_idx ON jobs(jobID, username);
CREATE INDEX job_links_jobID_idx ON job_links(jobID);
CREATE INDEX job_errors_jobID_idx ON job_errors(jobID);
CREATE INDEX work_items_jobID_idx ON work_items(jobID);
CREATE INDEX work_items_serviceID_idx ON work_items(serviceID);
CREATE INDEX work_items_status_idx ON work_items(status);
CREATE INDEX workflow_steps_jobID_idx ON workflow_steps(jobID);
CREATE INDEX workflow_steps_jobID_StepIndex_idx ON workflow_steps(jobID, stepIndex);
CREATE INDEX workflow_steps_serviceID_idx ON workflow_steps(serviceID);
CREATE INDEX batch_jobID_service_ID_batchID ON batches(jobID, serviceID, batchID);
CREATE INDEX batch_items_jobID_service_ID_batchID ON batch_items(jobID, serviceID, batchID);
CREATE INDEX service_deployments_deployment_id_idx ON service_deployments(deployment_id);
