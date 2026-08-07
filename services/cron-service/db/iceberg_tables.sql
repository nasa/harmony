CREATE table catalog.iceberg.jobs (
	id integer,
	request_id text,
	username text,
	status text,
	progress integer,
	created_at timestamptz,
	updated_at timestamptz,
	request text,
	is_async boolean,
	batches_completed integer,
	num_input_granules integer,
	message text,
	job_id text,
	collection_ids text,
	ignore_errors boolean,
	destination_url text,
	service_name text,
	provider_id text,
	original_data_size double,
	output_data_size double);

CREATE table catalog.iceberg.job_links (
	id integer,
	job_id text,
	href text,
	type text,
	title text,
	rel text,
	temporal_start timestamptz,
	temporal_end timestamptz,
	bbox string,
	created_at timestamptz,
	updated_at timestamptz
);

CREATE table catalog.iceberg.work_items (
	id integer,
	job_id text,
	workflow_step_index integer,
	scroll_id text,
	service_id text,
	status text,
	stac_catalog_location text,
	created_at timestamptz,
	updated_at timestamptz,
	total_items_size double,
	retry_count integer,
	duration float,
	started_at timestamptz,
	sort_index integer,
	output_item_sizes_json text,
	message_category text
);

CREATE table catalog.iceberg.workflow_steps (
	id integer,
	job_id text,
	service_id text,
	step_index integer,
	work_item_count integer,
	operation text,
	created_at timestamptz,
	updated_at timestamptz,
	has_aggregated_output boolean,
	max_batch_inputs integer,
	max_batch_size_in_bytes integer,
	is_batched boolean,
	is_complete boolean,
	is_sequential boolean,
	completed_work_item_count integer,
	progress_weight float,
	always_wait_for_prior_step boolean
);