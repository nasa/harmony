// Package db implements higher level functions to interact with the database
package db

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/jmoiron/sqlx"
	"github.com/nasa/harmony/core-services/internal/appcontext"
)

// GetDB returns a connection to a database for the current environment. Panics if
// the connection cannot be established
func GetDB(logger *slog.Logger) *sqlx.DB {
	var conn *sqlx.DB
	var err error
	if os.Getenv("DATABASE_TYPE") == "sqlite" {
		conn, err = sqlx.Connect("sqlite3", filepath.Join("db", "test.sqlite3"))
		if err != nil {
			logger.Error(err.Error())
			panic(err)
		}
	} else {
		postgresUrl := os.Getenv("DATABASE_URL")
		conn, err = sqlx.Connect("pgx", postgresUrl)
		if err != nil {
			logger.Error(err.Error())
			panic(err)
		}
	}
	return conn
}

// Get the db connection for the given context
func GetDBForContext(ctx context.Context) *sqlx.DB {
	contextValue := ctx.Value(appcontext.DataKey{})
	contextData := contextValue.(appcontext.ContextData)
	return contextData.DB
}
