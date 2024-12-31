package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/nasa/harmony/core-services/internal/appcontext"
	"github.com/nasa/harmony/core-services/internal/cronjobs/workreaper"
	"github.com/nasa/harmony/core-services/internal/db"
	"github.com/nasa/harmony/core-services/internal/env"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/registry"

	_ "github.com/jackc/pgx/v5/stdlib" // Standard library bindings for pgx

	"github.com/robfig/cron"

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

	// set up cron jobs
	// NOTE: cron jobs are run asynchronously, so a job will restart even if it is still running from
	// the last time it was started. If this is a problem then the job should provide its own
	// synchronization to abort restarts
	crn := cron.New()
	crn.AddFunc("@every 30s", func() { workreaper.DeleteOldWork(ctx) })
	crn.AddFunc("@every 1m", func() { panic("Oh, no!") })
	crn.AddFunc("0 8 15 * * *", func() { log.Print("OK") })
	crn.Start()

	// start up non-cron/long-running services
	var exitSignalChan = make(chan registry.Service)
	for name, service := range registry.Registry {
		fmt.Println("Found service", name)
		registry.RunService(ctx, exitSignalChan, service)
	}

	// block forever
	for {
		service := <-exitSignalChan
		log.Print("Restarting service ", service.Name())
		registry.RunService(ctx, exitSignalChan, service)

	}

	sdkConfig, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		fmt.Println("Couldn't load default configuration. Have you set up your AWS account?")
		fmt.Println(err)
		return
	}
	sqsClient := sqs.NewFromConfig(sdkConfig)
	fmt.Println("Let's list the queues for your account.")
	var queueUrls []string
	paginator := sqs.NewListQueuesPaginator(sqsClient, &sqs.ListQueuesInput{})
	for paginator.HasMorePages() {
		output, err := paginator.NextPage(context.TODO())
		if err != nil {
			log.Printf("Couldn't get queues. Here's why: %v\n", err)
			break
		} else {
			queueUrls = append(queueUrls, output.QueueUrls...)
		}
	}
	if len(queueUrls) == 0 {
		fmt.Println("You don't have any queues!")
	} else {
		for _, queueUrl := range queueUrls {
			fmt.Printf("\t%v\n", queueUrl)
		}
	}

}
