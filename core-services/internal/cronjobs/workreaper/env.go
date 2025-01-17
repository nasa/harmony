// Environment variables for the work reaper
package workreaper

import (
	"fmt"
	"os"
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/nasa/harmony/core-services/internal/env"
)

type WorkReaperEnv struct {
	env.HarmonyEnv
	WorkReaperCron         string `validate:"required,cron"`
	WorkReaperBatchSize    int    `validate:"gte=1"`
	ReapableWorkAgeMinutes int    `validate:"gte=1"`
}

func InitEnv(baseEnv env.HarmonyEnv) WorkReaperEnv {
	cronEntry := os.Getenv("WORK_REAPER_CRON")
	if cronEntry == "" {
		cronEntry = WORK_REAPER_CRON
	}

	batchSize, err := strconv.Atoi(os.Getenv("WORK_REAPER_BATCH_SIZE"))
	if err != nil {
		batchSize = WORK_REAPER_BATCH_SIZE
	}
	reapableWorkAgeMinutes, err := strconv.Atoi(os.Getenv("REAPABLE_WORK_AGE_MINUTES"))
	if err != nil {
		reapableWorkAgeMinutes = REAPABLE_WORK_AGE_MINUTES
	}

	env := WorkReaperEnv{
		baseEnv,
		cronEntry,
		batchSize,
		reapableWorkAgeMinutes,
	}

	validate := validator.New(validator.WithRequiredStructEnabled())
	err = validate.Struct(env)
	if err != nil {
		fmt.Println("Invalid work reaper env vars")
		panic(err)
	}

	return env

}
