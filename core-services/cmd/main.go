package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/go-logr/logr"

	"github.com/nasa/harmony/core-services/internal/appcontext"
	"github.com/nasa/harmony/core-services/internal/cronjobs/workreaper"
	"github.com/nasa/harmony/core-services/internal/db"
	"github.com/nasa/harmony/core-services/internal/env"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/registry"
	_ "github.com/nasa/harmony/core-services/internal/services/sample"

	_ "github.com/jackc/pgx/v5/stdlib" // Standard library bindings for pgx

	"github.com/robfig/cron/v3"

	_ "github.com/mattn/go-sqlite3"

	"github.com/go-playground/validator/v10"
)

const PLUGIN_RESTART_DELAY = 5 * time.Second

// use a single instance of Validate, it caches struct info
var validate *validator.Validate

func main() {
	// TODO is this better than using an implicitly called `init` function?
	env.InitEnvVars()

	logger := logs.NewLogger()

	logger.Info("Running ...")

	ctx := context.Background()
	contextData := appcontext.ContextData{Logger: logger, DB: db.GetDB(logger)}
	ctx = context.WithValue(ctx, appcontext.DataKey{}, contextData)

	// create a wrapper to pass our logger to the cron manager
	lgr := logr.FromSlogHandler(logger.Handler())

	// set up cron jobs
	// skip jobs that are already running when their time comes around and recover from panics in jobs
	// so that this application doesn't crash
	crn := cron.New(cron.WithChain(
		cron.Recover(lgr),
		cron.SkipIfStillRunning(cron.DefaultLogger),
	))
	crn.AddFunc("@every 30s", func() { workreaper.DeleteOldWork(ctx) })
	crn.AddFunc("* * * * *", func() {
		logger.Info("Every minute")
		time.Sleep(10 * time.Second)
		logger.Info("Every minute done")
	})
	// test of panic recovery
	// crn.AddFunc("@every 1m", func() { panic("Oh, no!") })
	crn.Start()

	// start up non-cron/long-running services
	var exitSignalChan = make(chan registry.Service)
	for name, service := range registry.Registry {
		fmt.Println("Found service", name)
		registry.RunService(ctx, exitSignalChan, service)
	}

	// loop forever while blocking on the error channel. restart any services that fail
	for {
		service := <-exitSignalChan
		log.Print("Restarting service ", service.Name())
		registry.RunService(ctx, exitSignalChan, service)
	}
}
