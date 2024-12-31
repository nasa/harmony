// The appcontext package provides a ContextData type that contains data that is common to many
// functions
package appcontext

import (
	"log/slog"

	"github.com/jmoiron/sqlx"
)

// used to prevent collisions with libraries that might add data to a context
type DataKey struct{}

type ContextData struct {
	Logger *slog.Logger
	DB     *sqlx.DB
}
