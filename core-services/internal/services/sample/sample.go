package sample

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/nasa/harmony/core-services/internal/registry"
)

type User struct {
	UserId    int    `db:"user_id"`
	FirstName string `db:"first_name"`
	LastName  string `db:"last_name"`
	Email     string
	Password  sql.NullString
}

// MyPlugin example
type MyPlugin struct{}

func (p *MyPlugin) Name() string {
	return "sample-plugin"
}

func (p *MyPlugin) Execute(ctx context.Context) {
	fmt.Println("Executing Sample plugin")
	// Query the database, storing results in a []User (wrapped in []interface{})
	// people := []User{}
	// contextValue := ctx.Value("data")
	// var contextData = contextValue.(appcontext.ContextData)
	// var db *sqlx.DB = contextData.DB

	// db.Select(&people, "SELECT * FROM user ORDER BY first_name ASC")
	// jane, jason := people[0], people[1]

	// fmt.Printf("Jane: %#v\nJason: %#v\n", jane, jason)
	// time.Sleep(30 * time.Second)
	// fmt.Println("Panicking Sample plugin")
	// panic("Faking a problem")
}

func init() {
	fmt.Println("SAMPLE PLUGIN")
	registry.Register(&MyPlugin{})
}
