package sample

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	logs "github.com/nasa/harmony/core-services/internal/log"
	"github.com/nasa/harmony/core-services/internal/registry"
)

// Service example
type SampleService struct{}

func (p *SampleService) Name() string {
	return "sample-service"
}

func (p *SampleService) Execute(ctx context.Context) {
	for {
		listAWSQueues(ctx)
		time.Sleep(60 * time.Second)
	}

}

func listAWSQueues(ctx context.Context) {
	logger := logs.GetLoggerForContext(ctx)
	logger.Info("Executing Sample service")
	// CODE BELOW HERE IS JUST SCRATCH CODE TO TEST AWS SDK
	sdkConfig, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		logger.Info("Couldn't load default configuration. Have you set up your AWS account?")
		logger.Error(err.Error())
		return
	}
	sqsClient := sqs.NewFromConfig(sdkConfig)
	logger.Info("Let's list the queues for your account.")
	var queueUrls []string
	paginator := sqs.NewListQueuesPaginator(sqsClient, &sqs.ListQueuesInput{})
	for paginator.HasMorePages() {
		output, err := paginator.NextPage(context.TODO())
		if err != nil {
			logger.Error(fmt.Sprintf("Couldn't get queues. Here's why: %v\n", err))
			break
		} else {
			queueUrls = append(queueUrls, output.QueueUrls...)
		}
	}
	if len(queueUrls) == 0 {
		logger.Info("You don't have any queues!")
	} else {
		for _, queueUrl := range queueUrls {
			logger.Info(fmt.Sprintf("\t%v\n", queueUrl))
		}
	}
}

func init() {
	registry.Register(&SampleService{})
}
