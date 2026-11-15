/* What the learning AI knows of the cards (data/ai/cards.json, tools/build_ai.py) and the constants its code uses
 * (kirafan_ai.core.constants / messages, kirafan_ai.cards) - the port of the Python AI reads everything from here. */

export const LOCATION_DECK = 0x01, LOCATION_HAND = 0x02, LOCATION_MZONE = 0x04, LOCATION_SZONE = 0x08,
  LOCATION_GRAVE = 0x10, LOCATION_REMOVED = 0x20, LOCATION_EXTRA = 0x40, LOCATION_OVERLAY = 0x80;
export const POS_FACEUP_ATTACK = 0x1, POS_FACEDOWN_ATTACK = 0x2, POS_FACEUP_DEFENSE = 0x4, POS_FACEDOWN_DEFENSE = 0x8;
export const POS_FACEUP = 0x5, POS_DEFENSE = 0xc;
export const PHASE_DRAW = 0x01, PHASE_STANDBY = 0x02, PHASE_MAIN1 = 0x04, PHASE_BATTLE_START = 0x08,
  PHASE_BATTLE_STEP = 0x10, PHASE_DAMAGE = 0x20, PHASE_DAMAGE_CAL = 0x40, PHASE_BATTLE = 0x80, PHASE_MAIN2 = 0x100,
  PHASE_END = 0x200;
export const PHASES = [PHASE_DRAW, PHASE_STANDBY, PHASE_MAIN1, PHASE_BATTLE_START, PHASE_BATTLE_STEP, PHASE_DAMAGE,
  PHASE_DAMAGE_CAL, PHASE_BATTLE, PHASE_MAIN2, PHASE_END];

export const COUNTER_WEAK = 0xb01, COUNTER_UNLUCKY = 0xb02, COUNTER_BIND = 0xb03, COUNTER_HUNGER = 0xb04,
  COUNTER_SLEEP = 0xb05, COUNTER_ISOLATE = 0xb06, COUNTER_ATTACKS = 0xc01, COUNTER_RECOVERY = 0xc02,
  COUNTER_NARU = 0xc03, COUNTER_HIRO = 0xc04, COUNTER_GAUGE = 0xd01;
export const TRACKED_COUNTERS = [COUNTER_WEAK, COUNTER_UNLUCKY, COUNTER_BIND, COUNTER_HUNGER, COUNTER_SLEEP,
  COUNTER_ISOLATE, COUNTER_ATTACKS, COUNTER_RECOVERY, COUNTER_NARU, COUNTER_HIRO, COUNTER_GAUGE];
export const STATUS_COUNTERS = { 나약함: 0xb01, 불행: 0xb02, 속박: 0xb03, 배고픔: 0xb04, 수면: 0xb05, 고립: 0xb06 };

export const SUMMONER_CODES = [10050111, 10050112, 10050113, 10050114, 10050115, 10050116, 10050117];
export const TEST_SUMMONER = 10050110;

export const MSG_SELECT_BATTLECMD = 10, MSG_SELECT_IDLECMD = 11, MSG_SELECT_EFFECTYN = 12, MSG_SELECT_YESNO = 13,
  MSG_SELECT_OPTION = 14, MSG_SELECT_CARD = 15, MSG_SELECT_CHAIN = 16, MSG_SELECT_TRIBUTE = 20, MSG_SELECT_SUM = 23,
  MSG_SELECT_UNSELECT_CARD = 26, MSG_ANNOUNCE_NUMBER = 143;
export const MSG_TYPES = [10, 11, 12, 13, 14, 15, 16, 20, 23, 26, 143];   // sorted(POLICY_MESSAGES)

// option kinds (kirafan_ai.core.messages K_*)
export const K_IDLE_SUMMON = 0, K_IDLE_SPSUMMON = 1, K_IDLE_REPOS = 2, K_IDLE_MSET = 3, K_IDLE_SSET = 4,
  K_IDLE_ACTIVATE = 5, K_IDLE_TO_BP = 6, K_IDLE_TO_EP = 7, K_BATTLE_ACTIVATE = 9, K_BATTLE_ATTACK = 10,
  K_BATTLE_TO_M2 = 11, K_BATTLE_TO_EP = 12, K_EFFECTYN_YES = 13, K_EFFECTYN_NO = 14, K_YESNO_YES = 15,
  K_YESNO_NO = 16, K_OPTION = 17, K_CARD_PICK = 18, K_CARD_FINISH = 19, K_CARD_CANCEL = 20, K_CHAIN_ACTIVATE = 21,
  K_CHAIN_PASS = 22, K_NUMBER = 23;
export const ACTIVATE_KINDS = new Set([K_IDLE_ACTIVATE, K_BATTLE_ACTIVATE, K_CHAIN_ACTIVATE]);
export const CONTEXT_KINDS = new Set([...ACTIVATE_KINDS, K_BATTLE_ATTACK, K_IDLE_SUMMON, K_IDLE_SPSUMMON]);
export const PROGRESS_KINDS = new Set([K_IDLE_TO_BP, K_IDLE_TO_EP, K_BATTLE_TO_M2, K_BATTLE_TO_EP, K_CHAIN_PASS,
  K_EFFECTYN_NO, K_YESNO_NO, K_CARD_FINISH, 26]);

/** aux.Stringid: code * 2^20 + index (past 32 bits: no bit operators on it) */
export const sid = (code, idx) => code * 1048576 + idx;
export const descCode = (desc) => Math.floor(desc / 1048576);
export const descIndex = (desc) => desc % 1048576;
export const NOOP_DESCS = new Set([sid(10050111, 1), sid(10050111, 6), sid(10050111, 8)]);

export const CLASS_RACES = [0x1, 0x2, 0x4, 0x8, 0x10];   // 전사, 마법사, 나이트, 승려, 알케미스트
export const CLASS_NAMES = { 1: "전사", 2: "마법사", 4: "나이트", 8: "승려", 16: "알케미스트" };
export const ATTRIBUTES = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40];
export const ATTRIBUTE_NAMES = { 1: "땅", 2: "물", 4: "불", 8: "바람", 16: "해", 32: "달", 64: "소환사" };

/** the card database as kirafan_ai.cards.CardDB, with each card's text numbers (cardtext.CardText) read already */
export class CardDB {
  constructor(json, vocabCodes) {
    this.cards = new Map();
    for (const [code, c] of Object.entries(json.cards)) {
      this.cards.set(Number(code), {
        code: Number(code), level: c.level, race: c.race, attribute: c.attribute, attack: c.atk, defense: c.def,
        name: c.name, desc: c.desc, strings: c.strings, class_index: c.cls, attribute_index: c.att,
        is_battle: c.battle, is_support: c.support, is_creamate: c.creamate, text: c.text, draws: c.draws,
        taunt: c.taunt, cleanse: c.cleanse, cleanseDotte: c.cleanseDotte, buffDotte: c.buffDotte,
        buffSkill: c.buffSkill, handBuff: c.handBuff,
      });
    }
    this.buffTable = json.buffTable;
    this.toolTable = json.toolTable;
    // embedding ids: 0 = unknown / hidden; every summoner shares one card id
    this.vocab = new Map(vocabCodes.map((c, i) => [c, i + 1]));
    this.cardVocab = new Map(this.vocab);
    const summoners = SUMMONER_CODES.filter((c) => this.vocab.has(c));
    for (const c of summoners) this.cardVocab.set(c, this.vocab.get(summoners[0]));
  }

  get(code) {
    return this.cards.get(code) || null;
  }

  /** CardDB.describe: the text of an effect description */
  describe(desc) {
    const code = descCode(desc), idx = descIndex(desc);
    const card = this.cards.get(code);
    if (card && idx < 16 && card.strings[idx]) return card.strings[idx].replace(/\n/g, " ");
    if (code === 0) return `system:${idx}`;
    return `${card ? card.name : code}#${idx}`;
  }
}

/** cardtext.text_of */
export function textOf(db, code) {
  const card = db.get(code);
  return card ? card.text : EMPTY_TEXT;
}

const EMPTY_TEXT = {
  dotte: 0, extra_stiff: 0, single_dmg: 0, all_dmg: 0, heal_single: 0, heal_all: 0, draw: 0, atk_up: 0,
  overheal: false, enemy_status: null, dotte_heal_single: 0, dotte_heal_all: 0, dotte_single: 0, dotte_all: 0,
  dotte_rules: [], dotte_options: [], dotte_var: null, dotte_hits: false, dotte_to_all: false, dotte_stiff: 0,
  dotte_weak: null, dotte_self_atk: 0, dotte_self_atk_opp: false, dotte_more_attacks: null, half_all: false,
  unstiff_after_attack: false, not_attackable: false, vs_attr_atk: null, start: [], gauge_gain: [],
  more_attacks: [], attack_gauge: 1, attack_weak: false, passive_atk: [],
};

let loaded = null;

/** { db, model } once data/ai/cards.json and the model (data/ai/model.json + .bin) are loaded */
export async function loadAI() {
  if (!loaded) {
    loaded = (async () => {
      const [cards, meta, bin] = await Promise.all([
        fetch("data/ai/cards.json").then((r) => r.json()),
        fetch("data/ai/model.json").then((r) => r.json()),
        fetch("data/ai/model.bin").then((r) => r.arrayBuffer()),
      ]);
      const weights = new Float32Array(bin);
      const w = {};
      for (const [name, [offset, shape]] of Object.entries(meta.tensors)) {
        const size = shape.reduce((a, b) => a * b, 1);
        w[name] = { data: weights.subarray(offset, offset + size), shape };
      }
      return { db: new CardDB(cards, meta.vocab), model: { w, config: meta.config, update: meta.update, dims: meta.dims } };
    })();
  }
  return loaded;
}
