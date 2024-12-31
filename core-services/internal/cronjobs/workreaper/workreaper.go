// The workreaper package implements a cron job to delete old work-items and workflow steps
package workreaper

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/nasa/harmony/core-services/internal/appcontext"
	"github.com/nasa/harmony/core-services/internal/db"
	"github.com/nasa/harmony/core-services/internal/models/job"
)

func DeleteTerminalWorkItems(ctx context.Context, notUpdatedForMinutes int, jobStatus []job.JobStatus) {
	var done = false
	var startingId = 0
	// var totalDeleted = 0
	batchSize, err := strconv.Atoi(os.Getenv("WORK_REAPER_BATCH_SIZE"))
	if err != nil {
		// use default batch size
		batchSize = 100
	}

	contextData := ctx.Value(appcontext.DataKey{}).(appcontext.ContextData)
	logger := contextData.Logger

	logger.Info("Work reaper delete terminal items started.")

	for !done {
		workItemIds := db.GetWorkItemIdsByJobUpdateAgeAndStatus(ctx, notUpdatedForMinutes, jobStatus, startingId, batchSize)
		if len(workItemIds) > 0 {
			logger.Info(fmt.Sprintf("Deleting %d work-items", len(workItemIds)))
			// fmt.Println("WORK ITEM IDS:")
			// for _, id := range workItemIds {
			// 	fmt.Println(id)
			// }
		}
		done = true
	}
}
