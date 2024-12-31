// package logs provides functions to support logging in the app
package logs

import (
	"log/slog"
	"os"
	"strings"
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
