package main

import (
	"testing"
	"time"
)

// A gift to a non-player neighbour nobody has visited: its account is created first.
func TestAGiftReachesAnUnvisitedNeighbour(t *testing.T) {
	app, owner := newEconomyApp(t)
	if _, err := app.FindRecordById("users", "npcneighbor0003"); err == nil {
		t.Fatal("the neighbour already has an account")
	}
	gifts, err := sendGift(app, owner, "npcneighbor0003", "coins", time.Now())
	if err != nil || gifts.SentToday != 1 {
		t.Fatalf("send = %+v, %v", gifts, err)
	}
}
