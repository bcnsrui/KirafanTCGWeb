/* EDOPro's puzzles (data/puzzles.json, from the game's puzzles folder): a script that lays out the field with
 * the Debug library (Debug.AddCard ... Debug.ReloadFieldEnd, runtime.js), talks through Debug.ShowHint and sets
 * its own ends with effects of the duel (Duel.RegisterEffect, aux.BeginPuzzle); then the turns as usual, from
 * player 0's first, without the opening deal. */
import { Duel, EMZONE } from "./duel.js?v=standby2";
import { DuelEnd } from "./flow.js";

Object.assign(Duel.prototype, {
  /** the effects registered to the duel for player p (Duel.RegisterEffect) are held by a card of that player's
   *  that is nowhere: they work wherever it is (inRange), for its controller */
  registerGlobal(e, p) {
    this.globalHolders ||= [];
    let holder = this.globalHolders[p];
    if (!holder) {
      holder = this.globalHolders[p] = this.newCard(0, p);
      holder.controller = p;
    }
    e.global = true;
    this.register(holder, e);
  },

  /** Debug.AddCard: a card made where the puzzle says; one more in a taken monster / support zone goes under
   *  the card there (a battle creamate's HP cards, the summoner's 성채석), as ocgcore's xyz_add */
  puzzleAddCard(code, owner, player, location, sequence, position) {
    const C = this.C;
    let loc = location;
    let seq = sequence;
    if (loc === EMZONE) {
      loc = C.LOCATION_MZONE;
      seq += 5;
    } else if (loc === C.LOCATION_MMZONE) loc = C.LOCATION_MZONE;
    else if (loc === C.LOCATION_STZONE) loc = C.LOCATION_SZONE;
    const card = this.newCard(code, owner);
    if (loc === C.LOCATION_MZONE || loc === C.LOCATION_SZONE) {
      const zone = loc === C.LOCATION_MZONE ? this.p[player].mzone : this.p[player].szone;
      const holder = zone[seq];
      if (holder) {
        card.holder = holder;
        card.controller = holder.controller;
        card.location = C.LOCATION_OVERLAY;
        card.position = C.POS_FACEUP;
        card.sequence = holder.overlay.length;
        holder.overlay.push(card);
      } else {
        card.controller = player;
        card.location = loc;
        card.sequence = seq;
        card.position = position || C.POS_FACEUP_ATTACK;
        zone[seq] = card;
      }
      return card;
    }
    const list = this.zoneList(player, loc);
    if (!list) return card;
    card.controller = player;
    card.location = loc;
    card.position = loc === C.LOCATION_DECK || loc === C.LOCATION_HAND ? C.POS_FACEDOWN_DEFENSE
      : loc === C.LOCATION_EXTRA && !card.isType(C.TYPE_PENDULUM) ? C.POS_FACEDOWN_DEFENSE : position || C.POS_FACEUP;
    list.push(card);
    this.renumber(player);
    return card;
  },

  /** a phase effect the puzzle gives a summoner (its own 드로우 / 스탠바이 페이즈 as the story goes) takes the
   *  place of the summoner's own at that phase: only the puzzle's happens */
  puzzleReplaces(card, e) {
    const C = this.C;
    if (!card.isType(C.TYPE_XYZ) || (e.code & 0xf000) !== C.EVENT_PHASE) return;
    for (const old of [...card.effects]) if (old.builtin && old.code === e.code) this.unregister(old);
  },

  /** Debug.ShowHint: the page shows it (onHint) and the game waits until it is read */
  async showHint(text) {
    if (this.onHint) await this.onHint(text);
  },

  /** Duel.SkipPhase: player p does not have this phase in this turn */
  skipPhase(p, phase) {
    (this.skipped ||= []).push({ player: p, phase });
  },

  /** the puzzle's script lays out the duel, its first words are read, then the turns */
  async playPuzzle(source) {
    this.sharedCounts = new Map();
    this.hintQueue = [];
    try {
      this.puzzleSetup = true;
      this.rt.exec("puzzle", source);
      this.puzzleSetup = false;
      for (const text of this.hintQueue.splice(0)) await this.showHint(text);
      this.events = [];
      await this.settle();
      await this.runTurns();
    } catch (err) {
      if (!(err instanceof DuelEnd)) throw err;
    }
    return this.winner;
  },
});
