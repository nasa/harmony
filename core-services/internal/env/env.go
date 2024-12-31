// The env package sets up environment variables using .env as well as declared env vars
package env

import (
	"log"

	"github.com/joho/godotenv"
)

func InitEnvVars() {
	// read the env from .env
	err := godotenv.Load()
	if err != nil {
		// try one directory up - useful when running locally
		err = godotenv.Load("../.env")
		if err != nil {
			log.Fatal("Error loading .env file")
		}
	}
}
