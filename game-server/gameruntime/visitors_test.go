package gameruntime

import (
	"testing"
	"time"

	"coffe-mania/shared/gamerules"
	"coffe-mania/shared/gamewire"
)

func TestSpecialVisitorsComeOneAtATimeFromTheLevel(t *testing.T) {
	r, _ := economyRoom(&economyStore{})
	rules := gamerules.Visitors()
	now := time.Now()
	r.level = rules.MinLevel - 1
	if _, ok := r.chooseVisitor(now, 0, 0); ok {
		t.Fatal("a visitor came below the minimum level")
	}
	r.level = rules.MinLevel
	if _, ok := r.chooseVisitor(now, rules.ChancePercent, 0); ok {
		t.Fatal("a visitor came on a losing roll")
	}
	visitor, ok := r.chooseVisitor(now, 0, 0)
	if !ok || visitor.MinLevel > r.level {
		t.Fatalf("first visitor: %+v %v", visitor, ok)
	}
	if _, ok := r.chooseVisitor(now.Add(time.Second), 0, 0); ok {
		t.Fatal("a second visitor came within the cooldown")
	}
	later := now.Add(gamerules.VisitorCooldown())
	r.actors["npc:vip"] = &entity{Actor: gamewire.Actor{ID: "npc:vip", Kind: "npc", VIP: visitor.ID}}
	if _, ok := r.chooseVisitor(later, 0, 0); ok {
		t.Fatal("a second visitor came while one is inside")
	}
	delete(r.actors, "npc:vip")
	if _, ok := r.chooseVisitor(later, 0, 0); !ok {
		t.Fatal("no visitor after the cooldown")
	}
	// Higher levels add the later celebrities.
	r.level = 260
	seen := map[string]bool{}
	for pick := range len(rules.List) {
		r.vipFrom = time.Time{}
		v, _ := r.chooseVisitor(later, 0, pick)
		seen[v.ID] = true
	}
	if len(seen) != len(rules.List) {
		t.Fatalf("visitors at the top level: %v", seen)
	}
}

func TestAVisitorPaysAsAVisitor(t *testing.T) {
	store := &economyStore{}
	r, _ := economyRoom(store)
	now := time.Now()
	customer := seatedCustomer(r, now)
	customer.VIP = "critic_initial"
	r.advanceNPC(customer, now)
	r.advanceNPC(customer, now.Add(gamerules.SelfPickup()))
	if len(store.vips) != 1 || store.vips[0] != "critic_initial" {
		t.Fatalf("the serving reached persistence as %v", store.vips)
	}
}
