package registry

import (
	"context"
	"fmt"

	logs "github.com/nasa/harmony/core-services/internal/log"
)

// Registry holds registered services
var Registry = make(map[string]Service)

// Service interface
type Service interface {
	Name() string
	Execute(context.Context)
}

// Register registers a services
func Register(s Service) {
	fmt.Println("Registering service", s.Name())
	Registry[s.Name()] = s
}

// Run a service in a goroutine, signaling on the given channel if the service crashes so
// it can be restarted by calling RunService again
func RunService(ctx context.Context, ch chan Service, s Service) {
	logger := logs.GetLoggerForContext(ctx)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error(fmt.Sprintf("Recovered from panic: %v", r))
				ch <- s
			}
		}()
		logger.Info(fmt.Sprintf("Using service %s", s.Name()))
		s.Execute(ctx)
	}()
}
