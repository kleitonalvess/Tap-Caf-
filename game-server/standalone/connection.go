package standalone

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"coffe-mania/game-server/gameruntime"
	"coffe-mania/shared/gamewire"
)

// Connection stands in for the room WebSocket. The client speaks the same
// protocol: it opens, sends join, then commands, and reads the room events.
// Unlike a socket, it survives Suspend: the room sleeps, and on Resume the
// connection joins the new room, whose welcome resets the client's sequence.
type Connection struct {
	engine  *Engine
	deliver func([]byte)
	closed  func()
	in      chan []byte

	mu     sync.Mutex
	open   bool
	joined bool
	peer   *gameruntime.Peer
	// Bumped whenever the peer changes, so a late event from an old room
	// never reaches the client after the new welcome.
	gen int
}

// Connect opens a connection. deliver receives each room event (JSON) in
// order; closed runs once if the café ends the connection.
func (e *Engine) Connect(deliver func([]byte), closed func()) *Connection {
	c := &Connection{engine: e, deliver: deliver, closed: closed, in: make(chan []byte, 64), open: true}
	e.mu.Lock()
	e.conns[c] = true
	e.mu.Unlock()
	go c.read()
	return c
}

// Send queues a message from the client; commands run in the order sent.
func (c *Connection) Send(data []byte) {
	c.mu.Lock()
	if !c.open {
		c.mu.Unlock()
		return
	}
	queued := true
	select {
	case c.in <- data:
	default:
		queued = false
	}
	c.mu.Unlock()
	if !queued {
		// The server closes a socket that floods commands, too.
		c.end()
	}
}

// Close is the client closing its socket.
func (c *Connection) Close() {
	c.mu.Lock()
	if !c.open {
		c.mu.Unlock()
		return
	}
	c.open = false
	peer := c.peer
	c.peer = nil
	c.gen++
	close(c.in)
	c.mu.Unlock()
	c.engine.mu.Lock()
	delete(c.engine.conns, c)
	c.engine.mu.Unlock()
	if peer != nil {
		peer.Closed.Store(true)
		if m := c.engine.current(); m != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			m.Leave(ctx, peer)
			cancel()
		}
	}
}

// end closes the connection from the café's side and tells the client.
func (c *Connection) end() {
	c.mu.Lock()
	open := c.open
	c.mu.Unlock()
	if !open {
		return
	}
	c.Close()
	if c.closed != nil {
		c.closed()
	}
}

func (c *Connection) read() {
	for data := range c.in {
		var command gamewire.Command
		if json.Unmarshal(data, &command) != nil {
			c.end()
			return
		}
		if command.Type == "join" {
			c.mu.Lock()
			first := !c.joined
			c.joined = true
			c.mu.Unlock()
			if first {
				c.attach()
			}
			continue
		}
		c.mu.Lock()
		peer := c.peer
		c.mu.Unlock()
		m := c.engine.current()
		if peer == nil || m == nil {
			// Paused or between rooms: the client's request times out and it
			// retries, as after a dropped socket.
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := m.Command(ctx, peer, command)
		cancel()
		if err != nil && !errors.Is(err, gameruntime.ErrClosed) && !errors.Is(err, gameruntime.ErrBusy) {
			c.end()
			return
		}
	}
}

// attach enters the room for a joined connection, unless the café is paused.
func (c *Connection) attach() {
	c.mu.Lock()
	if !c.open || !c.joined || c.peer != nil {
		c.mu.Unlock()
		return
	}
	c.gen++
	gen := c.gen
	c.mu.Unlock()
	m := c.engine.current()
	if m == nil {
		return
	}
	peer := &gameruntime.Peer{ID: c.engine.nextPeerID(), Ticket: c.engine.ticket(), Out: make(chan []byte, 256)}
	stop := make(chan struct{})
	var once sync.Once
	peer.Kick = func() {
		peer.Closed.Store(true)
		once.Do(func() { close(stop) })
		// The room kicks every peer when it stops; that is a pause, not an end.
		go func() {
			if !c.engine.isSuspended() {
				c.mu.Lock()
				current := c.peer == peer
				c.mu.Unlock()
				if current {
					c.end()
				}
			}
		}()
	}
	c.mu.Lock()
	if !c.open || c.gen != gen {
		c.mu.Unlock()
		return
	}
	c.peer = peer
	c.mu.Unlock()
	go c.forward(peer, stop, gen)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err := m.Join(ctx, peer)
	cancel()
	if err == nil {
		return
	}
	c.mu.Lock()
	if c.peer == peer {
		c.peer = nil
	}
	c.mu.Unlock()
	once.Do(func() { close(stop) })
	// A room closed by a pause in the meantime is joined again on Resume.
	if errors.Is(err, gameruntime.ErrClosed) && c.engine.isSuspended() {
		return
	}
	c.end()
}

// detach lets go of the room before a pause; the peer's queue is dropped.
func (c *Connection) detach() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.peer = nil
	c.gen++
}

func (c *Connection) forward(peer *gameruntime.Peer, stop chan struct{}, gen int) {
	for {
		select {
		case <-stop:
			return
		case data := <-peer.Out:
			c.mu.Lock()
			if c.open && c.gen == gen {
				c.deliver(data)
			}
			c.mu.Unlock()
		}
	}
}
