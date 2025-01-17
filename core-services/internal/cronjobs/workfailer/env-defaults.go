package workfailer

// The cron entry for scheduling the work reaper
const WORK_FAILER_CRON = "@every 300s"

// WorkItems that have not been updated for more than this many minutes are
// updated by the work failer (resulting either in job and work item failure or a retry)
const FAILABLE_WORK_AGE_MINUTES = 5

// The batch size used by work-failer. Set it to 0 will effectively disable work-failer.
const WORK_FAILER_BATCH_SIZE = 1000

// Maximum number of work items allowed on the work item update queue before halting failing work items
// Set the value to -1 to always fail work items
const MAX_WORK_ITEMS_ON_UPDATE_QUEUE_FAILER = 1000
