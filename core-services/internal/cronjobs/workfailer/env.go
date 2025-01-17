// Environment variables for the work failer
package workfailer

import (
	"fmt"
	"os"
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/nasa/harmony/core-services/internal/env"
)

type WorkFailerEnv struct {
	env.HarmonyEnv
	WorkFailerCron                  string `validate:"required,cron"`
	WorkFailerBatchSize             int    `validate:"gte=1"`
	FailableWorkAgeMinutes          int    `validate:"gte=1"`
	MaxWorkItemsOnUpdateQueueFailer int    `validate:"gte1"`
}

func InitEnv(baseEnv env.HarmonyEnv) WorkFailerEnv {
	cronEntry := os.Getenv("WORK_FAILER_CRON")
	if cronEntry == "" {
		cronEntry = WORK_FAILER_CRON
	}

	batchSize, err := strconv.Atoi(os.Getenv("WORK_FAILER_BATCH_SIZE"))
	if err != nil {
		batchSize = WORK_FAILER_BATCH_SIZE
	}
	failableWorkAgeMinutes, err := strconv.Atoi(os.Getenv("FAILABLE_WORK_AGE_MINUTES"))
	if err != nil {
		failableWorkAgeMinutes = FAILABLE_WORK_AGE_MINUTES
	}
	maxWorkItemsOnUpdateQueueFailer, err := strconv.Atoi(os.Getenv("MAX_WORK_ITEMS_ON_UPDATE_QUEUE_FAILER"))
	if err != nil {
		maxWorkItemsOnUpdateQueueFailer = MAX_WORK_ITEMS_ON_UPDATE_QUEUE_FAILER
	}

	env := WorkFailerEnv{
		baseEnv,
		cronEntry,
		batchSize,
		failableWorkAgeMinutes,
		maxWorkItemsOnUpdateQueueFailer,
	}

	validate := validator.New(validator.WithRequiredStructEnabled())
	err = validate.Struct(env)
	if err != nil {
		fmt.Println("Invalid work failer env vars")
		panic(err)
	}

	return env

}
