package registry

import (
	"context"
	"fmt"
)

// Registry holds registered plugins
var Registry = make(map[string]Plugin)

// Plugin interface
type Plugin interface {
	Name() string
	Execute(context.Context)
}

// Register registers a plugin
func Register(p Plugin) {
	fmt.Println("Registering plugin", p.Name())
	Registry[p.Name()] = p
}

// Run a plugin in a goroutine, signalling on the given channel if the plugin crashes so
// it can be restarted by calling RunPlugin again
func RunPlugin(ctx context.Context, ch chan Plugin, plugin Plugin) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Println("Recovered from panic:", r)
				ch <- plugin
			}
		}()
		fmt.Println("Using ", plugin.Name)
		plugin.Execute(ctx)
	}()
}
