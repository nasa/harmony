package workreaper

// The cron entry for scheduling the work reaper
const WORK_REAPER_CRON = "@every 30s"

// WorkItems and WorkflowSteps (in a terminal state) older than this many minutes are checked by the work reaper
const REAPABLE_WORK_AGE_MINUTES = 20160

// The batch size of the work reaper service
const WORK_REAPER_BATCH_SIZE = 2000
