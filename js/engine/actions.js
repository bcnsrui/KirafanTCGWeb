/* What the Lua scripts do to cards (Duel.Draw, Duel.Remove, Duel.SpecialSummon ...): each moves cards through
 * Duel.move and raises the events ocgcore raises for that action, handled once the action is over. */
import { Duel } from "./duel.js";

const list = (x) => (x ? (Array.isArray(x) ? x : [x]) : []);

Object.assign(Duel.prototype, {
  /** the order an action takes its cards in, ocgcore's card_operation_sort: the turn player's first, then by
   *  location; under a card by its zone and then their order, in a pile the top first, elsewhere the zone order
   *  (where the cards land - the village's order, the zones they take - follows it) */
  inOperationOrder(cards) {
    const C = this.C, tp = this.turnPlayer;
    const piles = C.LOCATION_DECK | C.LOCATION_EXTRA | C.LOCATION_GRAVE | C.LOCATION_REMOVED;
    const side = (c) => {
      const p = c.holder ? c.holder.controller : c.controller;
      return p === tp ? 0 : p === 1 - tp ? 1 : 2;
    };
    const loc = (c) => (c.holder ? C.LOCATION_OVERLAY : c.location);
    return list(cards).slice().sort((a, b) => side(a) - side(b) || loc(a) - loc(b)
      || (a.holder ? a.holder.sequence - b.holder.sequence || a.sequence - b.sequence
        : a.location & piles ? b.sequence - a.sequence : a.sequence - b.sequence));
  },

  /** the events of one action over the cards it moved (left the field, to the deck / graveyard, its own) */
  afterMoves(moved, code, info) {
    const C = this.C;
    if (!moved.length) return 0;
    const left = moved.filter((c) => c.previous.location & C.LOCATION_ONFIELD);
    if (left.length) this.raise(C.EVENT_LEAVE_FIELD, left, info);
    if (code) this.raise(code, moved, info);
    const toDeck = moved.filter((c) => c.location & (C.LOCATION_DECK | C.LOCATION_EXTRA));
    if (toDeck.length && code !== C.EVENT_TO_DECK) this.raise(C.EVENT_TO_DECK, toDeck, info);
    const toGrave = moved.filter((c) => c.location === C.LOCATION_GRAVE);
    if (toGrave.length && code !== C.EVENT_TO_GRAVE) this.raise(C.EVENT_TO_GRAVE, toGrave, info);
    return moved.length;
  },

  /** draws n from the top of p's deck (a player who cannot draw loses) */
  draw(p, n, reason = 0, rp = p, re = null) {
    const C = this.C;
    this.alignDeckTop?.(p, n);   // (a replay: the cards EDOPro drew on top, js/engine/replay.js)
    const drawn = [];
    for (let i = 0; i < n; i++) {
      const card = this.p[p].deck[this.p[p].deck.length - 1];
      if (!card) {
        this.lose(p, "deck");
        break;
      }
      this.move(card, C.LOCATION_HAND, { reason: reason | C.REASON_DRAW, rp, re });
      drawn.push(card);
    }
    if (drawn.length) {
      this.emit("draw", { player: p, cards: drawn });
      this.raise(C.EVENT_DRAW, drawn, { ep: p, ev: drawn.length, r: reason, rp, re });
      this.raise(C.EVENT_TO_HAND, drawn, { ep: p, r: reason, rp, re });
    }
    return drawn.length;
  },

  /** the top n of p's deck to the graveyard (돗테오키 존) */
  discardDeck(p, n, reason = 0, rp = p, re = null) {
    const C = this.C;
    this.alignDeckTop?.(p, n);
    const moved = [];
    for (let i = 0; i < n; i++) {
      const card = this.p[p].deck[this.p[p].deck.length - 1];
      if (!card) break;
      moved.push(this.move(card, C.LOCATION_GRAVE, { reason: reason | C.REASON_EFFECT, rp, re }));
    }
    return this.afterMoves(moved, C.EVENT_TO_GRAVE, { r: reason, rp, re });
  },

  remove(cards, pos, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = this.inOperationOrder(cards).map((c) => this.move(c, C.LOCATION_REMOVED, { pos: pos || C.POS_FACEUP, reason, rp, re }));
    return this.afterMoves(moved, C.EVENT_REMOVE, { r: reason, rp, re });
  },

  sendtoGrave(cards, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = this.inOperationOrder(cards).map((c) => this.move(c, C.LOCATION_GRAVE, { reason, rp, re }));
    return this.afterMoves(moved, C.EVENT_TO_GRAVE, { r: reason, rp, re });
  },

  sendtoHand(cards, player, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = this.inOperationOrder(cards).map((c) => this.move(c, C.LOCATION_HAND, { reason, rp, re }));
    return this.afterMoves(moved, C.EVENT_TO_HAND, { r: reason, rp, re });
  },

  /** seq: 0 the top, 1 the bottom, 2 (SEQ_DECKSHUFFLE) shuffled in; an extra deck card (a summoner) goes back
   *  to its extra deck; -2 takes it out of the duel */
  sendtoDeck(cards, player, seq, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = [];
    const shuffled = new Set();
    for (const c of this.inOperationOrder(cards)) {
      if (seq === -2) {
        this.removeFromPlace(c);
        c.previous = { controller: c.controller, location: c.location, sequence: c.sequence, position: c.position };
        c.location = 0;
        this.emit("move", { card: c, from: c.previous, to: { controller: c.owner, location: 0, sequence: 0, position: 0 }, reason });
        continue;
      }
      const to = c.isType(C.TYPE_EXTRA) || c.token ? C.LOCATION_EXTRA : C.LOCATION_DECK;
      moved.push(this.move(c, to, { seq: seq === 2 ? 0 : seq, pos: to === C.LOCATION_EXTRA ? C.POS_FACEDOWN_DEFENSE : null, reason, rp, re }));
      if (seq === 2 && to === C.LOCATION_DECK) shuffled.add(c.owner);
    }
    for (const p of shuffled) this.shuffleDeck(p);
    return this.afterMoves(moved, C.EVENT_TO_DECK, { r: reason, rp, re });
  },

  sendtoExtraP(cards, player, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = this.inOperationOrder(cards).map((c) => this.move(c, C.LOCATION_EXTRA, { pos: C.POS_FACEUP_DEFENSE, reason, rp, re }));
    return this.afterMoves(moved, C.EVENT_TO_DECK, { r: reason, rp, re });
  },

  /** destroyed: a creamate (a pendulum monster) goes face-up to its extra deck (성전), anything else to the graveyard */
  destroy(cards, reason = 0, rp = 0, re = null) {
    const C = this.C;
    const moved = [];
    for (const c of this.inOperationOrder(cards)) {
      if (!(c.location & C.LOCATION_ONFIELD) || c.holder) continue;
      moved.push(this.move(c, C.LOCATION_GRAVE, { reason: reason | C.REASON_DESTROY, rp, re }));
      this.emit("destroyed", { card: c });
    }
    if (moved.length) this.raise(C.EVENT_DESTROYED, moved, { r: reason, rp, re });
    return this.afterMoves(moved, null, { r: reason, rp, re });
  },

  overlay(holder, cards) {
    const C = this.C;
    const moved = list(cards).filter((c) => c !== holder).map((c) => this.move(c, C.LOCATION_OVERLAY, { holder, reason: C.REASON_RULE }));
    return this.afterMoves(moved, null, {});
  },

  shuffleDeck(p) {
    this.shuffle(this.p[p].deck);
    this.renumber(p);
    this.emit("shuffle", { player: p });
  },

  /** onto the field: the monster zones (a creamate's battle zone, the summoner's extra monster zone) */
  specialSummon(cards, sumplayer, targetPlayer, pos, re = null, procedure = false) {
    const C = this.C;
    const summoned = [];
    for (const c of this.inOperationOrder(cards)) {
      const zones = this.freeZones(targetPlayer, C.LOCATION_MZONE)
        .filter((s) => s < 5 || c.isType(C.TYPE_EXTRA));   // (the extra monster zones: the summoner)
      if (!zones.length) continue;
      this.move(c, C.LOCATION_MZONE, { player: targetPlayer, seq: zones[0], pos: pos || C.POS_FACEUP_ATTACK,
        reason: C.REASON_SPSUMMON | (procedure ? C.REASON_RULE : C.REASON_EFFECT), rp: sumplayer, re });
      c.summonTurn = this.turn;
      summoned.push(c);
      this.emit("summon", { card: c });
    }
    if (summoned.length) {
      this.afterMoves(summoned, null, { rp: sumplayer, re });
      this.raise(C.EVENT_SPSUMMON_SUCCESS, summoned, { ep: sumplayer, rp: sumplayer, re });
    }
    return summoned.length;
  },

  /** a support creamate (or a token) into the spell / trap zones */
  moveToField(card, movePlayer, targetPlayer, dest, pos) {
    const C = this.C;
    const zones = this.freeZones(targetPlayer, dest);
    if (!zones.length) return false;
    this.move(card, dest, { player: targetPlayer, seq: zones[0], pos: pos || C.POS_FACEUP, reason: C.REASON_RULE, rp: movePlayer });
    this.afterMoves([card], C.EVENT_MOVE, { rp: movePlayer });
    return true;
  },

  changePosition(cards, pos) {
    let n = 0;
    for (const c of this.inOperationOrder(cards)) {
      if (!(c.location & this.C.LOCATION_ONFIELD) || c.position === pos) continue;
      c.position = pos;
      n++;
      this.emit("position", { card: c, position: pos });
    }
    return n;
  },

  damage(p, n, reason = 0) {
    if (n <= 0) return 0;
    this.emit("damage", { player: p, amount: n });
    this.setLP(p, this.p[p].lp - n);
    return n;
  },
});

export { list };
