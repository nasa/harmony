package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/nasa/harmony/core-services/internal/appcontext"
	"github.com/nasa/harmony/core-services/internal/cronjobs/workreaper"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/models/job"
	"github.com/nasa/harmony/core-services/internal/registry"

	_ "github.com/jackc/pgx/v5/stdlib" // Standard library bindings for pgx

	"github.com/joho/godotenv"

	"github.com/robfig/cron"

	"github.com/jmoiron/sqlx"
	_ "github.com/mattn/go-sqlite3"

	"github.com/go-playground/validator/v10"
)

const PLUGIN_RESTART_DELAY = 5 * time.Second

// use a single instance of Validate, it caches struct info
var validate *validator.Validate

func main() {
	// read the env from .env
	err := godotenv.Load()
	if err != nil {
		// try one directory up - useful when running locally
		err = godotenv.Load("../.env")
		if err != nil {
			log.Fatal("Error loading .env file")
		}
	}

	var logLevel = logs.GetLogLevel()

	var logger *slog.Logger
	if strings.ToLower(os.Getenv("TEXT_LOGGER")) == "true" {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	} else {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	}

	logger.Info("Running ...")

	postgresUrl := os.Getenv("DATABASE_URL")

	var db *sqlx.DB

	if os.Getenv("DATABASE_TYPE") == "sqlite" {
		db, err = sqlx.Connect("sqlite3", filepath.Join("db", "test.sqlite3"))
		if err != nil {
			log.Fatalln(err)
		}
	} else {
		db, err = sqlx.Connect("pgx", postgresUrl)
		if err != nil {
			log.Fatal(err)
		}
	}

	ctx := context.Background()

	ctx = context.WithValue(ctx, appcontext.DataKey{}, appcontext.ContextData{Logger: logger, DB: db})

	crn := cron.New()
	crn.AddFunc("@every 10s", func() { workreaper.DeleteTerminalWorkItems(ctx, 1, job.TerminalStatuses) })
	crn.AddFunc("@every 1m", func() { panic("Oh, no!") })
	crn.AddFunc("0 8 15 * * *", func() { log.Print("OK") })
	crn.Start()

	var exitSignalChan = make(chan registry.Plugin)
	for name, plugin := range registry.Registry {
		fmt.Println("Found plugin", name)
		registry.RunPlugin(ctx, exitSignalChan, plugin)
	}

	// block forever
	for {
		plugin := <-exitSignalChan
		log.Print("Restarting plugin ", plugin.Name())
		registry.RunPlugin(ctx, exitSignalChan, plugin)

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
