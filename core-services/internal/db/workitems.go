package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/models/job"
	"github.com/nasa/harmony/core-services/internal/models/workitem"
)

// GetWorkItemIdsByJobUpdateAgeAndStatus returns the ids of work items belonging to jobs that
// have the given status and have not been updated for the given number of minutes, or an error
// if there is a problem.
// ctx should contain a `data` value that contains a `db` which is a
// sql database connection. An optional starting id and batch size (max number of results) can be
// provided, with default values of 0 and 2000 respectively.
func GetWorkItemIdsByJobUpdateAgeAndStatus(
	ctx context.Context,
	notUpdatedForMinutes int,
	jobStatus []job.JobStatus,
	vargs ...int) ([]int, error) {
	startingId := 0
	batchSize := 2000
	// this is how we handle default parameters in golang :-(
	if len(vargs) > 0 {
		startingId = vargs[0]
	}
	if len(vargs) > 1 {
		batchSize = vargs[1]
	}

	logger := logs.GetLoggerForContext(ctx)
	db := GetDBForContext(ctx)
	timeStamp := time.Now().Add(time.Duration(notUpdatedForMinutes) * time.Minute)
	ids := []int{}
	stmt := fmt.Sprintf(`SELECT w.id FROM %s as w INNER JOIN %s as j ON "w"."jobID" = "j"."jobID"
	WHERE "j"."updatedAt" < ? AND j.status IN (?) AND w.id > ? ORDER BY w.id ASC LIMIT ?
	`, workitem.Table, job.Table)
	query, args, bindErr := sqlx.In(stmt, timeStamp, jobStatus, startingId, batchSize)
	if bindErr != nil {
		logger.Error("Failed to bind query")
		return nil, bindErr
	}

	// sqlx.In returns queries with the `?` bindvar, we can rebind it for our backend
	// need to do this for postgres - sqlite works with ? or $1 style
	query = db.Rebind(query)

	err := db.Select(&ids, query, args...)
	if err != nil {
		return nil, err
	}

	return ids, nil
}

// DeleteWorkItemsById deletes work-items and returns the number of rows deleted, or an error
func DeleteWorkItemsById(ctx context.Context, ids []int) (int64, error) {
	logger := logs.GetLoggerForContext(ctx)
	db := GetDBForContext(ctx)

	stmt := fmt.Sprintf(`DELETE FROM %s WHERE id IN (?)`, workitem.Table)
	query, args, bindErr := sqlx.In(stmt, ids)
	if bindErr != nil {
		logger.Error("Failed to bind query")
		return 0, bindErr
	}

	query = db.Rebind(query)

	result, err := db.Exec(query, args...)
	if err != nil {
		logger.Error(err.Error())
		return 0, err
	}
	numRows, _ := result.RowsAffected()
	logger.Info(fmt.Sprintf("Deleted %d work-items", numRows))
	return numRows, nil
}
