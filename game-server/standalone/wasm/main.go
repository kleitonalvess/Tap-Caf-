//go:build js && wasm

// Command wasm is the standalone café for the browser (GOOS=js GOARCH=wasm).
// It publishes globalThis.coffeEngine for the page's Web Worker:
//
//	start(save, profile, lastSeenMs, hooks) → "" or an error message
//	fetch(method, path, body) → Promise<{status, body}>
//	connect(id), send(id, text), disconnect(id)
//	suspend() → Promise, resume(), export() → Promise<string>
//	prepare(save, profileId, savedAtMs) → {save, error}: an imported save,
//	checked and frozen in time (PrepareImport)
//
// hooks: message(id, text) and close(id) for connections, state() when the
// HUD values changed and commit() after every saved change.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"syscall/js"
	"time"

	"coffe-mania/game-server/gameruntime"
	"coffe-mania/game-server/standalone"
	"coffe-mania/shared/cafe"
)

var (
	mu          sync.Mutex
	engine      *standalone.Engine
	connections = map[int]*standalone.Connection{}
)

func main() {
	js.Global().Set("coffeEngine", js.ValueOf(map[string]any{
		"start":      js.FuncOf(start),
		"fetch":      js.FuncOf(fetch),
		"connect":    js.FuncOf(connect),
		"send":       js.FuncOf(send),
		"disconnect": js.FuncOf(disconnect),
		"suspend":    js.FuncOf(suspend),
		"resume":     js.FuncOf(resume),
		"export":     js.FuncOf(export),
		"prepare":    js.FuncOf(prepare),
	}))
	select {}
}

func current() *standalone.Engine {
	mu.Lock()
	defer mu.Unlock()
	return engine
}

func start(_ js.Value, args []js.Value) any {
	if len(args) < 4 {
		return "argumentos inválidos"
	}
	mu.Lock()
	defer mu.Unlock()
	if engine != nil {
		return "o café já foi aberto"
	}
	store := cafe.NewMemoryStore()
	if args[0].Type() == js.TypeString && args[0].String() != "" {
		loaded, err := cafe.LoadMemoryStore([]byte(args[0].String()))
		if err != nil {
			return "save ilegível: " + err.Error()
		}
		store = loaded
	}
	var profile standalone.Profile
	if json.Unmarshal([]byte(args[1].String()), &profile) != nil {
		return "perfil inválido"
	}
	var lastSeen time.Time
	if ms := args[2].Float(); ms > 0 {
		lastSeen = time.UnixMilli(int64(ms))
	}
	hooks := args[3]
	created, err := standalone.New(store, profile, lastSeen, gameruntime.Options{}, standalone.Hooks{
		Committed:   func() { hooks.Call("commit") },
		PlayerState: func() { hooks.Call("state") },
	})
	if err != nil {
		return err.Error()
	}
	engine = created
	// The hooks object stays referenced for the page's lifetime.
	js.Global().Set("coffeEngineHooks", hooks)
	return ""
}

// promise runs work on its own goroutine: a callback from JavaScript must not
// block the event loop.
func promise(work func() (any, error)) any {
	var handler js.Func
	handler = js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			defer handler.Release()
			value, err := work()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}
			resolve.Invoke(value)
		}()
		return nil
	})
	return js.Global().Get("Promise").New(handler)
}

var errNotStarted = errors.New("o café ainda não foi aberto")

func fetch(_ js.Value, args []js.Value) any {
	method, path, body := args[0].String(), args[1].String(), ""
	if len(args) > 2 && args[2].Type() == js.TypeString {
		body = args[2].String()
	}
	return promise(func() (any, error) {
		e := current()
		if e == nil {
			return nil, errNotStarted
		}
		status, response := e.Fetch(method, path, []byte(body))
		return map[string]any{"status": status, "body": string(response)}, nil
	})
}

func connect(_ js.Value, args []js.Value) any {
	e := current()
	if e == nil {
		return false
	}
	id := args[0].Int()
	hooks := js.Global().Get("coffeEngineHooks")
	c := e.Connect(
		func(data []byte) { hooks.Call("message", id, string(data)) },
		func() {
			mu.Lock()
			delete(connections, id)
			mu.Unlock()
			hooks.Call("close", id)
		},
	)
	mu.Lock()
	connections[id] = c
	mu.Unlock()
	return true
}

func send(_ js.Value, args []js.Value) any {
	mu.Lock()
	c := connections[args[0].Int()]
	mu.Unlock()
	if c != nil {
		c.Send([]byte(args[1].String()))
	}
	return nil
}

func disconnect(_ js.Value, args []js.Value) any {
	id := args[0].Int()
	mu.Lock()
	c := connections[id]
	delete(connections, id)
	mu.Unlock()
	if c != nil {
		go c.Close()
	}
	return nil
}

func suspend(js.Value, []js.Value) any {
	return promise(func() (any, error) {
		e := current()
		if e == nil {
			return nil, errNotStarted
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return nil, e.Suspend(ctx)
	})
}

func resume(js.Value, []js.Value) any {
	if e := current(); e != nil {
		e.Resume()
	}
	return nil
}

func export(js.Value, []js.Value) any {
	return promise(func() (any, error) {
		e := current()
		if e == nil {
			return nil, errNotStarted
		}
		data, err := e.Export()
		if err != nil {
			return nil, err
		}
		return string(data), nil
	})
}

func prepare(_ js.Value, args []js.Value) any {
	fail := func(message string) any { return map[string]any{"save": "", "error": message} }
	if len(args) < 3 || args[0].Type() != js.TypeString || args[1].Type() != js.TypeString || args[2].Type() != js.TypeNumber {
		return fail("argumentos inválidos")
	}
	saved := time.UnixMilli(int64(args[2].Float()))
	data, err := standalone.PrepareImport([]byte(args[0].String()), args[1].String(), saved, time.Now())
	if err != nil {
		return fail(err.Error())
	}
	return map[string]any{"save": string(data), "error": ""}
}
