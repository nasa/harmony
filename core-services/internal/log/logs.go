// package logs provides functions to support logging in the app
package logs

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/nasa/harmony/core-services/internal/appcontext"
)

// GetLogLevel returns the log level for the current environment
func GetLogLevel() slog.Level {
	envLevel := strings.ToLower(os.Getenv("LOG_LEVEL"))
	var level slog.Level
	switch envLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}
	return level
}

// NewLogger returns an slog text logger if the TEXT_LOGGER environment variable is "true",
// or an slog JSON logger otherwise
func NewLogger() *slog.Logger {
	var logger *slog.Logger
	if strings.ToLower(os.Getenv("TEXT_LOGGER")) == "true" {
		logger = slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: GetLogLevel()}))
	} else {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: GetLogLevel()}))
	}
	return logger
}

// GetLoggerForContext returns the logger for the given context
func GetLoggerForContext(ctx context.Context) *slog.Logger {
	contextValue := ctx.Value(appcontext.DataKey{})
	contextData := contextValue.(appcontext.ContextData)
	return contextData.Logger
}
