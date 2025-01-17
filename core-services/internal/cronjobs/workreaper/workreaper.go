// The workreaper package implements a cron job to delete old work-items and workflow steps
package workreaper

import (
	"context"
	"fmt"

	"github.com/nasa/harmony/core-services/internal/db"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/models/job"
)

func deleteTerminalWorkItems(ctx context.Context, notUpdatedForMinutes int, jobStatus []job.JobStatus, batchSize int) {
	var done = false
	var startingId = 0
	var totalDeleted int64 = 0

	logger := logs.GetLoggerForContext(ctx)

	logger.Info("Work reaper delete terminal items started")

	for !done {
		workItemIds, err := db.GetWorkItemIdsByJobUpdateAgeAndStatus(ctx, notUpdatedForMinutes, jobStatus, startingId, batchSize)
		if err != nil {
			logger.Error("Failed to get work-item ids for deletion")
		}
		if len(workItemIds) > 0 {
			logger.Info(fmt.Sprintf("Deleting %d work-items", len(workItemIds)))
			numDeleted, err := db.DeleteWorkItemsById(ctx, workItemIds)
			if err != nil {
				logger.Error("Failed to delete work-items")
			}
			totalDeleted += numDeleted
		}

		if len(workItemIds) < batchSize {
			done = true
		}
	}

	logger.Info(fmt.Sprintf("Done deleting work-items. Total work-items deleted: %d", totalDeleted))
}

func deleteTerminalWorkflowSteps(ctx context.Context, notUpdatedForMinutes int, jobStatus []job.JobStatus, batchSize int) {
	var done = false
	var startingId = 0
	var totalDeleted int64 = 0

	logger := logs.GetLoggerForContext(ctx)

	logger.Info("Work reaper delete terminal workflow steps started")

	for !done {
		workItemIds, err := db.GetWorkflowStepIdsByJobUpdateAgeAndStatus(ctx, notUpdatedForMinutes, jobStatus, startingId, batchSize)
		if err != nil {
			logger.Error("Failed to get workflow step ids for deletion")
		}
		if len(workItemIds) > 0 {
			logger.Info(fmt.Sprintf("Deleting %d workflow steps", len(workItemIds)))
			numDeleted, err := db.DeleteWorkflowStepsById(ctx, workItemIds)
			if err != nil {
				logger.Error("Failed to delete workflow steps")
			}
			totalDeleted += numDeleted
		}

		if len(workItemIds) < batchSize {
			done = true
		}
	}

	logger.Info(fmt.Sprintf("Done deleting workflow steps. Total workflow steps deleted: %d", totalDeleted))
}

func DeleteOldWork(ctx context.Context, env WorkReaperEnv) {
	deleteTerminalWorkItems(ctx, env.ReapableWorkAgeMinutes, job.TerminalStatuses, env.WorkReaperBatchSize)
	deleteTerminalWorkflowSteps(ctx, env.ReapableWorkAgeMinutes, job.TerminalStatuses, env.WorkReaperBatchSize)

}
