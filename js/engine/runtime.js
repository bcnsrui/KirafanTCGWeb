/* The card scripts in a Lua VM (fengari): EDOPro's Lua API (Duel / Card / Effect / Group / aux) over the
 * engine (duel.js). A script's operation runs as a coroutine: when it asks a player (Duel.SelectMatchingCard,
 * SelectTarget, SelectYesNo, Group.Select, AnnounceNumber) it yields, and resumes with the answer.
 *
 * Lua integers are 32-bit here (EDOPro's are 64-bit): flags above 0x7fffffff (RESET_CHAIN) arrive negative and
 * are read back unsigned, and aux.Stringid makes a float (code * 2^20 + index, the same number). */
import { Card, Effect, EMZONE } from "./duel.js";

/** Lua run right after a card's script, changing it for the page: the two 앨리스 카터릿 turn into each other at the
 *  battle phase's end (the card itself changes, Duel._Transform) where EDOPro takes one out of the duel and
 *  makes the other in its place */
const alice = (code, to) => `_scripts[${code}].alicetrigger = function(e,tp,eg,ep,ev,re,r,rp)
  Kirafan6.kirafandrawop(e,tp,eg,ep,ev,re,r,rp,1)
  Duel.Hint(HINT_MESSAGE,tp,aux.Stringid(${code},1))
  Duel._Transform(e:GetHandler(),${to})
end`;
const PATCHES = { 10055112: alice(10055112, 10055113), 10055113: alice(10055113, 10055112) };

const PRELUDE = `
-- (what the Kirafan scripts use of EDOPro's utility.lua, and the Lua side of Group)
_scripts = {}
_cards = {}
_effects = {}
-- (a card's table is also the global c<code>, as EDOPro's: a puzzle may reach a card's functions so)
function GetID() local s = {} _scripts[_current_code] = s _G["c" .. _current_code] = s return s, _current_code end

Group = {}
GroupMT = { __index = Group }
local function excluded(c, ex)
  if ex == nil then return false end
  if rawget(ex, "_c") then return ex == c end
  for _, x in ipairs(ex) do if x == c then return true end end
  return false
end
-- (ocgcore keeps a group's cards in the order they were made - card_sort: cardid -; scripts that walk a group
-- with GetFirst / GetNext depend on it: Kirafan6.consumedotte)
local function uid(c) return rawget(c, "_c") or 0 end
local function sorted(g) table.sort(g, function(a, b) return uid(a) < uid(b) end) return g end
function Group.CreateGroup() return setmetatable({}, GroupMT) end
function Group.FromCards(...)
  local g = Group.CreateGroup()
  for _, c in ipairs({...}) do if not excluded(c, g) then g[#g + 1] = c end end
  return sorted(g)
end
function Group.GetCount(g) return #g end
function Group.GetFirst(g) rawset(g, "_i", 1) return g[1] end
function Group.GetNext(g) local i = (rawget(g, "_i") or 1) + 1 rawset(g, "_i", i) return g[i] end
function Group.Iter(g) local i = 0 return function() i = i + 1 return g[i] end end
function Group.Filter(g, f, ex, ...)
  local out = Group.CreateGroup()
  for _, c in ipairs(g) do if not excluded(c, ex) and (f == nil or f(c, ...)) then out[#out + 1] = c end end
  return out
end
function Group.FilterCount(g, f, ex, ...) return #Group.Filter(g, f, ex, ...) end
function Group.IsExists(g, f, n, ex, ...) return #Group.Filter(g, f, ex, ...) >= n end
function Group.GetSum(g, f, ...) local s = 0 for _, c in ipairs(g) do s = s + f(c, ...) end return s end
function Group.GetClassCount(g, f, ...)
  local seen, n = {}, 0
  for _, c in ipairs(g) do local k = f(c, ...) if not seen[k] then seen[k] = true n = n + 1 end end
  return n
end
function Group.Clone(g) return Group.Filter(g, nil, nil) end
function Group.AddCard(g, c) if not excluded(c, g) then g[#g + 1] = c sorted(g) end return g end
function Group.Select(g, tp, mn, mx, ex) return Duel._Select(tp, Group.Filter(g, nil, ex), mn, mx, false) end
function Group.RandomSelect(g, tp, n) return Duel._RandomSelect(g, n) end

aux = {}
function aux.Stringid(code, id) return code * 1048576.0 + id end
function aux.Next(g)
  local first = true
  return function() if first then first = false return g:GetFirst() end return g:GetNext() end
end
-- (utility.lua's: a puzzle lost at its first turn's end, without its draw and standby phases)
function aux.BeginPuzzle()
  local e1 = Effect.GlobalEffect()
  e1:SetType(EFFECT_TYPE_FIELD + EFFECT_TYPE_CONTINUOUS)
  e1:SetCode(EVENT_TURN_END)
  e1:SetCountLimit(1)
  e1:SetOperation(function() Duel.SetLP(0, 0) end)
  Duel.RegisterEffect(e1, 0)
  for _, code in ipairs({ EFFECT_SKIP_DP, EFFECT_SKIP_SP }) do
    local e = Effect.GlobalEffect()
    e:SetType(EFFECT_TYPE_FIELD)
    e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
    e:SetCode(code)
    e:SetTargetRange(1, 0)
    Duel.RegisterEffect(e, 0)
  end
end
function aux.FALSE() return false end
function aux.TRUE() return true end
function aux.FilterBoolFunction(f, ...) local a = { ... } return function(c) return f(c, table.unpack(a)) end end

function Duel.GetMatchingGroup(f, p, s, o, ex, ...) return Group.Filter(Duel._FieldCards(p, s, o), f, ex, ...) end
function Duel.GetMatchingGroupCount(f, p, s, o, ex, ...) return #Duel.GetMatchingGroup(f, p, s, o, ex, ...) end
function Duel.IsExistingMatchingCard(f, p, s, o, n, ex, ...) return #Duel.GetMatchingGroup(f, p, s, o, ex, ...) >= n end
function Duel.SelectMatchingCard(tp, f, p, s, o, mn, mx, ex, ...)
  return Duel._Select(tp, Duel.GetMatchingGroup(f, p, s, o, ex, ...), mn, mx, false)
end
function Duel.IsExistingTarget(f, p, s, o, n, ex, ...)
  return #Duel.GetMatchingGroup(f, p, s, o, ex, ...):Filter(Duel._IsTargetable, nil) >= n
end
function Duel.SelectTarget(tp, f, p, s, o, mn, mx, ex, ...)
  return Duel._SelectTarget(tp, Duel.GetMatchingGroup(f, p, s, o, ex, ...):Filter(Duel._IsTargetable, nil), mn, mx)
end
`;

function loadFengari() {
  if (window.fengari) return Promise.resolve(window.fengari);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("../vendor/fengari-web.js", import.meta.url).href;
    s.onload = () => resolve(window.fengari);
    s.onerror = () => reject(new Error("Lua VM(fengari)을 불러오지 못했습니다"));
    document.head.append(s);
  });
}

export async function createRuntime(scripts) {
  const fengari = await loadFengari();
  return new Runtime(fengari, scripts);
}

export class Runtime {
  constructor(fengari, scripts) {
    this.f = fengari;
    const { lua, lauxlib, lualib } = fengari;
    this.lua = lua;
    this.lx = lauxlib;
    this.scripts = scripts;
    this.loaded = new Set();
    this.errors = [];
    this.request = null;
    this.duel = null;
    const L = (this.L = lauxlib.luaL_newstate());
    lualib.luaL_openlibs(L);
    for (const t of ["Duel", "Card", "Effect", "Debug"]) {
      lua.lua_newtable(L);
      lua.lua_setglobal(L, this.s(t));
    }
    this.exec("constant.lua", this.scripts["constant.lua"].replace(/^Duel\.LoadScript.*$/gm, ""));
    this.exec("prelude", PRELUDE);
    this.C = this.readConstants();
    this.bindApi();
    // (EDOPro's type() names its objects: the scripts tell a Card from a Group with it)
    this.exec("metatables", `CardMT = { __index = Card }  EffectMT = { __index = Effect }
      local rawtype = type
      function type(v)
        if rawtype(v) == "table" then
          local mt = getmetatable(v)
          if mt == CardMT then return "Card" elseif mt == GroupMT then return "Group" elseif mt == EffectMT then return "Effect" end
        end
        return rawtype(v)
      end`);
    this.loadScript("CS_init.lua");
  }

  s(text) {
    return this.f.to_luastring(text);
  }

  exec(name, source) {
    const { lua, lx } = this;
    const L = this.L;
    const st = lx.luaL_loadbuffer(L, this.s(source), null, this.s("@" + name)) || lua.lua_pcall(L, 0, 0, 0);
    if (st) {
      const msg = lua.lua_tojsstring(L, -1);
      lua.lua_pop(L, 1);
      this.error(`${name}: ${msg}`);
      return false;
    }
    return true;
  }

  loadScript(name) {
    if (this.loaded.has(name)) return true;
    this.loaded.add(name);
    const src = this.scripts[name];
    if (src === undefined) return false;
    return this.exec(name, src);
  }

  error(message) {
    this.errors.push(message);
    console.warn("[Lua]", message);
    if (this.duel) this.duel.emit("error", { message });
  }

  /** the numeric globals of constant.lua (negative 32-bit ones read back unsigned) */
  readConstants() {
    const { lua } = this;
    const L = this.L;
    const C = { LOCATION_EMZONE: EMZONE };
    lua.lua_pushglobaltable(L);
    lua.lua_pushnil(L);
    while (lua.lua_next(L, -2)) {
      if (lua.lua_type(L, -2) === lua.LUA_TSTRING && lua.lua_type(L, -1) === lua.LUA_TNUMBER) {
        const key = lua.lua_tojsstring(L, -2);
        if (/^[A-Z][A-Z0-9_]+$/.test(key)) {
          const v = lua.lua_tonumber(L, -1);
          C[key] = v < 0 && Number.isInteger(v) ? v >>> 0 : v;
        }
      }
      lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 1);
    C.LOCATION_EMZONE = EMZONE;
    return C;
  }

  // ---- values between JS and Lua ----------------------------------------------------
  push(L, v) {
    const { lua } = this;
    if (v === null || v === undefined) lua.lua_pushnil(L);
    else if (typeof v === "boolean") lua.lua_pushboolean(L, v);
    else if (typeof v === "number") {
      if (Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) lua.lua_pushinteger(L, v);
      else lua.lua_pushnumber(L, v);
    } else if (typeof v === "string") lua.lua_pushstring(L, this.s(v));
    else if (v instanceof Card) this.pushRegistered(L, "_cards", v.uid);
    else if (v instanceof Effect) this.pushRegistered(L, "_effects", v.id);
    else if (Array.isArray(v)) {
      // (a group: in the order the cards were made, as ocgcore's - the PRELUDE's sorted)
      if (v.every((c) => c instanceof Card)) v = [...v].sort((a, b) => a.uid - b.uid);
      lua.lua_createtable(L, v.length, 0);
      v.forEach((c, i) => {
        this.push(L, c);
        lua.lua_rawseti(L, -2, i + 1);
      });
      lua.lua_getglobal(L, this.s("GroupMT"));
      lua.lua_setmetatable(L, -2);
    } else lua.lua_pushnil(L);
  }

  pushRegistered(L, table, id) {
    const { lua } = this;
    lua.lua_getglobal(L, this.s(table));
    lua.lua_rawgeti(L, -1, id);
    lua.lua_remove(L, -2);
  }

  /** a Lua value as JS: number, boolean, string, Card, Effect, an array of Cards (a Group), null */
  read(L, i) {
    const { lua } = this;
    const t = lua.lua_type(L, i);
    if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, i);
    if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, i);
    if (t === lua.LUA_TSTRING) return lua.lua_tojsstring(L, i);
    if (t !== lua.LUA_TTABLE) return null;
    const card = this.field(L, i, "_c");
    if (card !== null) return this.duel.cards[card - 1] || null;
    const eff = this.field(L, i, "_e");
    if (eff !== null) return this.effects.get(eff) || null;
    const out = [];
    const n = lua.lua_rawlen(L, i);
    for (let k = 1; k <= n; k++) {
      lua.lua_rawgeti(L, i, k);
      const c = this.read(L, -1);
      lua.lua_pop(L, 1);
      if (c instanceof Card) out.push(c);
    }
    return out;
  }

  field(L, i, key) {
    const { lua } = this;
    lua.lua_getfield(L, i, this.s(key));
    const v = lua.lua_type(L, -1) === lua.LUA_TNUMBER ? lua.lua_tointeger(L, -1) : null;
    lua.lua_pop(L, 1);
    return v;
  }

  ref(L, i) {
    const { lua } = this;
    if (lua.lua_type(L, i) !== lua.LUA_TFUNCTION) return null;
    lua.lua_pushvalue(L, i);
    return this.lx.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  }

  // ---- calling Lua ------------------------------------------------------------------
  /** a Lua function that does not ask anyone (conditions, values, chk==0 checks): its first `nret` results */
  call(ref, args, nret = 1) {
    const { lua } = this;
    const L = this.L;
    const top = lua.lua_gettop(L);
    lua.lua_getglobal(L, this.s("debug"));
    lua.lua_getfield(L, -1, this.s("traceback"));
    lua.lua_remove(L, -2);
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    for (const a of args) this.push(L, a);
    const st = lua.lua_pcall(L, args.length, nret, top + 1);
    if (st) {
      this.error(lua.lua_tojsstring(L, -1));
      lua.lua_settop(L, top);
      return Array(nret).fill(null);
    }
    const out = [];
    for (let k = nret; k > 0; k--) out.push(this.read(L, -k));
    lua.lua_settop(L, top);
    return out;
  }

  /** a Lua function that may ask the players, as a coroutine: each question waits for its answer */
  async run(ref, args) {
    const { lua, lx } = this;
    const L = this.L;
    const co = lua.lua_newthread(L);
    const coRef = lx.luaL_ref(L, lua.LUA_REGISTRYINDEX);
    try {
      lua.lua_rawgeti(co, lua.LUA_REGISTRYINDEX, ref);
      for (const a of args) this.push(co, a);
      let st = lua.lua_resume(co, null, args.length);
      while (st === lua.LUA_YIELD) {
        const req = this.request;
        this.request = null;
        lua.lua_settop(co, 0);
        const results = req ? await req() : [];
        for (const v of results) this.push(co, v);
        st = lua.lua_resume(co, null, results.length);
      }
      if (st !== lua.LUA_OK) {
        lx.luaL_traceback(L, co, lua.lua_tostring(co, -1), 0);
        this.error(lua.lua_tojsstring(L, -1));
        lua.lua_pop(L, 1);
      }
    } finally {
      lx.luaL_unref(L, lua.LUA_REGISTRYINDEX, coRef);
    }
  }

  /** a question from inside a coroutine: `ask` (async) gives the values the Lua call returns */
  yieldFor(L, ask, fallback) {
    const { lua } = this;
    if (!lua.lua_isyieldable(L)) {
      const out = fallback();
      for (const v of out) this.push(L, v);
      return out.length;
    }
    this.request = ask;
    return lua.lua_yield(L, 0);
  }

  // ---- cards ------------------------------------------------------------------------
  /** a new card's Lua object, and its script's initial_effect */
  initCard(card) {
    const { lua } = this;
    const L = this.L;
    lua.lua_getglobal(L, this.s("_cards"));
    lua.lua_createtable(L, 0, 1);
    lua.lua_pushinteger(L, card.uid);
    lua.lua_setfield(L, -2, this.s("_c"));
    lua.lua_getglobal(L, this.s("CardMT"));
    lua.lua_setmetatable(L, -2);
    lua.lua_rawseti(L, -2, card.uid);
    lua.lua_pop(L, 1);
    const name = `c${card.code}.lua`;
    if (!this.loaded.has(name)) {
      lua.lua_pushinteger(L, card.code);
      lua.lua_setglobal(L, this.s("_current_code"));
      this.loadScript(name);
      if (PATCHES[card.code]) this.exec(`patch ${name}`, PATCHES[card.code]);
    }
    lua.lua_getglobal(L, this.s("_scripts"));
    lua.lua_rawgeti(L, -1, card.code);
    if (lua.lua_type(L, -1) === lua.LUA_TTABLE) {
      lua.lua_getfield(L, -1, this.s("initial_effect"));
      if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) {
        const ref = this.lx.luaL_ref(L, lua.LUA_REGISTRYINDEX);
        this.call(ref, [card], 0);
        this.lx.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
      } else lua.lua_pop(L, 1);
    }
    lua.lua_pop(L, 2);
  }

  newEffectObject(e) {
    const { lua } = this;
    const L = this.L;
    this.effects.set(e.id, e);
    lua.lua_getglobal(L, this.s("_effects"));
    lua.lua_createtable(L, 0, 1);
    lua.lua_pushinteger(L, e.id);
    lua.lua_setfield(L, -2, this.s("_e"));
    lua.lua_getglobal(L, this.s("EffectMT"));
    lua.lua_setmetatable(L, -2);
    lua.lua_rawseti(L, -2, e.id);
    lua.lua_pop(L, 1);
  }

  // ---- the API ----------------------------------------------------------------------
  bindApi() {
    this.effects = new Map();
    const { lua } = this;
    const rt = this;
    const d = () => rt.duel;
    const C = this.C;
    const n = (L, i, dflt = 0) => (lua.lua_isnoneornil(L, i) ? dflt : lua.lua_tonumber(L, i));
    const u = (L, i, dflt = 0) => n(L, i, dflt) >>> 0;
    const b = (L, i) => lua.lua_toboolean(L, i);
    const card = (L, i) => {
      const v = rt.read(L, i);
      return v instanceof Card ? v : null;
    };
    const cards = (L, i) => {
      const v = rt.read(L, i);
      return v instanceof Card ? [v] : Array.isArray(v) ? v : [];
    };
    const eff = (L, i) => {
      const v = rt.read(L, i);
      return v instanceof Effect ? v : null;
    };
    const ret = (L, ...vals) => {
      for (const v of vals) rt.push(L, v);
      return vals.length;
    };
    const def = (table, name, fn) => {
      lua.lua_getglobal(rt.L, rt.s(table));
      lua.lua_pushjsfunction(rt.L, fn);
      lua.lua_setfield(rt.L, -2, rt.s(name));
      lua.lua_pop(rt.L, 1);
    };
    const reason = () => d().current || { effect: null, player: 0 };
    // (as ocgcore: the continuous effects an action set off run before the script goes on - a creamate's own when
    // it falls in the middle of the damage, before the attacker's attack counter goes)
    // (only its own: one an effect of it does in turn has its events handled first, as ocgcore's nested processing)
    const acted = (L, act) => {
      const duel = d();
      const mark = duel.events.length;
      const v = act();
      if (duel.events.length === mark) return ret(L, v);
      const own = duel.events.splice(mark);
      return rt.yieldFor(L, async () => {
        await duel.handleRaised(own);
        return [v];
      }, () => {
        duel.events.push(...own);
        return [v];
      });
    };

    // -- Effect
    def("Effect", "CreateEffect", (L) => {
      const e = d().newEffect(card(L, 1));
      rt.newEffectObject(e);
      return ret(L, e);
    });
    const setter = (name, fn) => def("Effect", name, (L) => {
      fn(eff(L, 1), L);
      return 0;
    });
    setter("SetDescription", (e, L) => (e.description = n(L, 2)));
    setter("SetType", (e, L) => (e.type = u(L, 2)));
    setter("SetCode", (e, L) => (e.code = u(L, 2)));
    setter("SetProperty", (e, L) => (e.property = u(L, 2)));
    setter("SetRange", (e, L) => (e.range = u(L, 2)));
    setter("SetTargetRange", (e, L) => (e.targetRange = [u(L, 2), u(L, 3)]));
    setter("SetCountLimit", (e, L) => (e.countLimit = { max: n(L, 2, 1), code: lua.lua_isnoneornil(L, 3) ? 0 : n(L, 3), used: 0 }));
    setter("SetCondition", (e, L) => (e.condition = rt.ref(L, 2)));
    setter("SetCost", (e, L) => (e.cost = rt.ref(L, 2)));
    setter("SetTarget", (e, L) => (e.target = rt.ref(L, 2)));
    setter("SetOperation", (e, L) => (e.operation = rt.ref(L, 2)));
    setter("SetValue", (e, L) => {
      if (lua.lua_type(L, 2) === lua.LUA_TFUNCTION) e.valueFn = rt.ref(L, 2);
      else e.value = lua.lua_type(L, 2) === lua.LUA_TBOOLEAN ? b(L, 2) : n(L, 2);
    });
    setter("SetCategory", (e, L) => (e.category = u(L, 2)));
    setter("SetHintTiming", (e, L) => (e.hintTiming = [u(L, 2), u(L, 3)]));
    setter("SetReset", (e, L) => (e.reset = { flags: u(L, 2), count: n(L, 3, 1) || 1 }));
    setter("SetLabel", (e, L) => (e.label = n(L, 2)));
    def("Effect", "GetLabel", (L) => ret(L, eff(L, 1).label));
    def("Effect", "Clone", (L) => {
      const e = eff(L, 1).clone(++d().effectCount);
      rt.newEffectObject(e);
      return ret(L, e);
    });
    def("Effect", "GlobalEffect", (L) => {
      const e = d().newEffect(null);
      rt.newEffectObject(e);
      return ret(L, e);
    });
    // (one registered to the duel: the card that made it, not the one holding it - puzzle.js registerGlobal)
    def("Effect", "GetHandler", (L) => {
      const e = eff(L, 1);
      return ret(L, e.global && e.owner ? e.owner : e.handler);
    });
    def("Effect", "GetOwner", (L) => ret(L, eff(L, 1).owner));
    def("Effect", "GetHandlerPlayer", (L) => ret(L, eff(L, 1).handler.controller));
    def("Effect", "GetDescription", (L) => ret(L, eff(L, 1).description));
    def("Effect", "GetCode", (L) => ret(L, eff(L, 1).code));
    def("Effect", "IsHasType", (L) => ret(L, (eff(L, 1).type & u(L, 2)) !== 0));
    def("Effect", "GetActivateLocation", (L) => {
      const e = eff(L, 1);
      const duel = d();
      const link = [duel.building, duel.solving, ...duel.chain].find((l) => l && l.effect === e);
      return ret(L, link ? link.location : e.handler.location);
    });
    def("Effect", "Reset", (L) => {
      const e = eff(L, 1);
      if (e.registered) d().unregister(e);
      return 0;
    });

    // -- Card
    const cdef = (name, fn) => def("Card", name, (L) => fn(L, card(L, 1)));
    cdef("RegisterEffect", (L, c) => {
      d().register(c, eff(L, 2));
      return 0;
    });
    cdef("RegisterFlagEffect", (L, c) => {
      c.flags.push({ code: n(L, 2), reset: u(L, 3), count: n(L, 5, 1) || 1 });
      return 0;
    });
    cdef("GetFlagEffect", (L, c) => ret(L, d().flagCount(c, n(L, 2))));
    cdef("EnableCounterPermit", () => 0);
    cdef("AddCounter", (L, c) => ret(L, d().addCounter(c, n(L, 2), n(L, 3))));
    cdef("RemoveCounter", (L, c) => {
      d().removeCounter(c, n(L, 3), n(L, 4));
      return 0;
    });
    cdef("GetCounter", (L, c) => ret(L, c.counters.get(n(L, 2)) || 0));
    cdef("GetOverlayGroup", (L, c) => ret(L, [...c.overlay]));
    cdef("GetOverlayCount", (L, c) => ret(L, c.overlay.length));
    cdef("CheckRemoveOverlayCard", (L, c) => ret(L, c.overlay.length >= n(L, 3, 1)));
    cdef("GetAttack", (L, c) => ret(L, d().atkOf(c)));
    cdef("GetDefense", (L, c) => ret(L, d().defOf(c)));
    cdef("GetBaseAttack", (L, c) => ret(L, c.data.atk));
    cdef("GetBaseDefense", (L, c) => ret(L, c.data.def));
    cdef("GetLevel", (L, c) => ret(L, d().levelOf(c)));
    cdef("GetRace", (L, c) => ret(L, c.data.race));
    cdef("IsRace", (L, c) => ret(L, (c.data.race & u(L, 2)) !== 0));
    cdef("GetAttribute", (L, c) => ret(L, c.data.attribute));
    cdef("GetOriginalAttribute", (L, c) => ret(L, c.data.attribute));
    cdef("IsAttribute", (L, c) => ret(L, (c.data.attribute & u(L, 2)) !== 0));
    cdef("GetCode", (L, c) => ret(L, c.code));
    cdef("GetOriginalCode", (L, c) => ret(L, c.code));
    cdef("IsCode", (L, c) => {
      for (let i = 2; i <= lua.lua_gettop(L); i++) if (n(L, i) === c.code) return ret(L, true);
      return ret(L, false);
    });
    cdef("IsSetCard", (L, c) => ret(L, d().isSetCard(c, n(L, 2))));
    cdef("GetControler", (L, c) => ret(L, c.controller));
    cdef("IsControler", (L, c) => ret(L, c.controller === n(L, 2)));
    cdef("GetLocation", (L, c) => ret(L, c.location));
    cdef("IsLocation", (L, c) => ret(L, d().inLocation(c, u(L, 2))));
    cdef("GetSequence", (L, c) => ret(L, c.sequence));
    cdef("IsFaceup", (L, c) => ret(L, c.faceup));
    cdef("IsAttackPos", (L, c) => ret(L, (c.position & C.POS_ATTACK) !== 0));
    cdef("IsDefensePos", (L, c) => ret(L, (c.position & C.POS_DEFENSE) !== 0));
    cdef("IsPreviousControler", (L, c) => ret(L, c.previous.controller === n(L, 2)));
    cdef("IsPreviousLocation", (L, c) => ret(L, (c.previous.location & u(L, 2)) !== 0));
    cdef("IsReason", (L, c) => ret(L, (c.reason & u(L, 2)) !== 0));
    cdef("IsAbleToHand", (L, c) => ret(L, c.location !== C.LOCATION_HAND));
    cdef("IsAbleToRemoveAsCost", (L) => ret(L, true));
    cdef("IsCanBeSpecialSummoned", (L) => ret(L, d().locationCount(n(L, 4), C.LOCATION_MZONE) > 0));
    cdef("GetBattleTarget", (L, c) => {
      const duel = d();
      return ret(L, c === duel.attacker ? duel.attackTarget : c === duel.attackTarget ? duel.attacker : null);
    });
    cdef("IsRelateToBattle", (L, c) => {
      const duel = d();
      return ret(L, (c === duel.attacker || c === duel.attackTarget) && c.location === C.LOCATION_MZONE);
    });
    cdef("IsStatus", (L, c) => ret(L, u(L, 2) === C.STATUS_SPSUMMON_TURN ? c.summonTurn === d().turn : false));
    cdef("IsRelateToEffect", (L, c) => {
      const duel = d();
      const e = eff(L, 2);
      const link = [duel.solving, duel.building].find((l) => l && l.effect === e);
      if (!link) return ret(L, false);
      if (c === link.card) return ret(L, c.fieldId === link.fieldId || c.location === link.card.location);
      return ret(L, link.targets.some((t) => t.card === c && t.fieldId === c.fieldId));
    });
    cdef("SetUniqueOnField", (L, c) => {
      c.unique = { s: n(L, 2), o: n(L, 3), filter: rt.ref(L, 4), loc: u(L, 5) };
      return 0;
    });

    // -- Duel: the state
    const ddef = (name, fn) => def("Duel", name, fn);
    ddef("GetTurnPlayer", (L) => ret(L, d().turnPlayer));
    ddef("GetTurnCount", (L) => ret(L, d().turn));
    ddef("GetCurrentPhase", (L) => ret(L, d().phase));
    ddef("GetCurrentChain", (L) => {
      const duel = d();
      return ret(L, duel.solving ? duel.solving.index : duel.chain.length);
    });
    ddef("GetAttacker", (L) => ret(L, d().attacker));
    ddef("GetAttackTarget", (L) => ret(L, d().attackTarget));
    ddef("GetLP", (L) => ret(L, d().p[n(L, 1)].lp));
    ddef("GetFieldGroup", (L) => ret(L, d().fieldCards(n(L, 1), u(L, 2), u(L, 3))));
    ddef("_FieldCards", (L) => ret(L, d().fieldCards(n(L, 1), u(L, 2), u(L, 3))));
    ddef("GetFieldGroupCount", (L) => ret(L, d().fieldCards(n(L, 1), u(L, 2), u(L, 3)).length));
    ddef("GetLocationCount", (L) => ret(L, d().locationCount(n(L, 1), u(L, 2))));
    ddef("GetDecktopGroup", (L) => {
      d().alignDeckTop?.(n(L, 1), n(L, 2));
      const deck = d().p[n(L, 1)].deck;
      return ret(L, deck.slice(Math.max(0, deck.length - n(L, 2))).reverse());
    });
    ddef("GetFirstTarget", (L) => {
      const duel = d();
      const link = duel.solving || duel.building;
      return ret(L, link && link.targets[0] ? link.targets[0].card : null);
    });
    ddef("_IsTargetable", (L) => {
      const c = card(L, 1);
      const duel = d();
      const { effect, player } = reason();
      const blocked = duel.effectsOn(c, C.EFFECT_CANNOT_BE_EFFECT_TARGET)
        .some((e) => (e.valueFn ? duel.rt.call(e.valueFn, [e, effect, player], 1)[0] : e.value));
      return ret(L, !blocked);
    });
    ddef("LoadScript", (L) => ret(L, rt.loadScript(lua.lua_tojsstring(L, 1))));
    ddef("RegisterEffect", (L) => {
      d().registerGlobal(eff(L, 1), n(L, 2));
      return 0;
    });
    ddef("SkipPhase", (L) => {
      d().skipPhase(n(L, 1), u(L, 2));
      return 0;
    });

    // -- Debug: what the puzzles lay out the duel with (puzzle.js)
    const gdef = (name, fn) => def("Debug", name, fn);
    // flags: DUEL_ATTACK_FIRST_TURN (0x2) + DUEL_SIMPLE_AI, …
    gdef("ReloadFieldBegin", (L) => {
      d().duelFlags = n(L, 1) || 0;
      return 0;
    });
    gdef("ReloadFieldEnd", () => 0);
    ddef("IsDuelType", (L) => ret(L, ((d().duelFlags || 0) & n(L, 1)) !== 0));
    gdef("SetAIName", () => 0);
    gdef("SetPlayerInfo", (L) => {
      d().p[n(L, 1)].lp = n(L, 2);
      return 0;
    });
    gdef("AddCard", (L) => ret(L, d().puzzleAddCard(n(L, 1), n(L, 2), n(L, 3), u(L, 4), n(L, 5), u(L, 6))));
    gdef("PreAddCounter", (L) => {
      const c = card(L, 1);
      if (c) c.counters.set(n(L, 2), (c.counters.get(n(L, 2)) || 0) + n(L, 3, 1));
      return 0;
    });
    // (read before the game goes on: a hint in an effect waits there; the puzzle's opening ones are kept for later)
    gdef("ShowHint", (L) => {
      const text = lua.lua_tojsstring(L, 1);
      return rt.yieldFor(L, async () => {
        await d().showHint(text);
        return [];
      }, () => {
        (d().hintQueue ||= []).push(text);
        return [];
      });
    });
    gdef("Message", (L) => {
      console.log("[Lua]", lua.lua_tojsstring(L, 1));
      return 0;
    });
    ddef("SetOperationInfo", () => 0);
    ddef("SetChainLimit", (L) => {
      const link = d().building || d().solving;
      if (link) link.limit = rt.ref(L, 1);
      return 0;
    });
    ddef("Hint", (L) => {
      const duel = d();
      const type = n(L, 1);
      const p = n(L, 2);
      if (type === C.HINT_SELECTMSG) duel.hints[p] = n(L, 3);
      else duel.emit("hint", { player: p, hint: type, desc: n(L, 3) });
      return 0;
    });
    ddef("ConfirmCards", (L) => {
      d().emit("confirm", { player: n(L, 1), cards: cards(L, 2) });
      return 0;
    });

    // -- Duel: what changes the game
    ddef("Draw", (L) => acted(L, () => d().draw(n(L, 1), n(L, 2), u(L, 3), reason().player, reason().effect)));
    ddef("DiscardDeck", (L) => acted(L, () => d().discardDeck(n(L, 1), n(L, 2), u(L, 3), reason().player, reason().effect)));
    ddef("Remove", (L) => acted(L, () => d().remove(cards(L, 1), u(L, 2), u(L, 3), reason().player, reason().effect)));
    ddef("SendtoGrave", (L) => acted(L, () => d().sendtoGrave(cards(L, 1), u(L, 2), reason().player, reason().effect)));
    ddef("SendtoHand", (L) => acted(L, () => d().sendtoHand(cards(L, 1), lua.lua_isnoneornil(L, 2) ? null : n(L, 2), u(L, 3), reason().player, reason().effect)));
    ddef("SendtoDeck", (L) => acted(L, () => d().sendtoDeck(cards(L, 1), lua.lua_isnoneornil(L, 2) ? null : n(L, 2), n(L, 3), u(L, 4), reason().player, reason().effect)));
    ddef("SendtoExtraP", (L) => acted(L, () => d().sendtoExtraP(cards(L, 1), n(L, 2), u(L, 3), reason().player, reason().effect)));
    ddef("Destroy", (L) => acted(L, () => d().destroy(cards(L, 1), u(L, 2), reason().player, reason().effect)));
    ddef("Overlay", (L) => acted(L, () => d().overlay(card(L, 1), cards(L, 2))));
    ddef("ShuffleDeck", (L) => {
      d().shuffleDeck(n(L, 1));
      return 0;
    });
    ddef("SpecialSummon", (L) => acted(L, () => d().specialSummon(cards(L, 1), n(L, 3), n(L, 4), u(L, 7, C.POS_FACEUP), reason().effect)));
    ddef("MoveToField", (L) => acted(L, () => d().moveToField(card(L, 1), n(L, 2), n(L, 3), u(L, 4), u(L, 5))));
    ddef("ChangePosition", (L) => acted(L, () => d().changePosition(cards(L, 1), u(L, 2))));
    ddef("Damage", (L) => ret(L, d().damage(n(L, 1), n(L, 2), u(L, 3))));
    ddef("SetLP", (L) => {
      d().setLP(n(L, 1), n(L, 2));
      return 0;
    });
    ddef("CreateToken", (L) => {
      const c = d().newCard(n(L, 2), n(L, 1));
      // (a card of a token's type; any other card made so is a card like the rest: 다크니스 앨리스 카터릿's
      // 이상한 나라의 앨리스 카터릿 goes to the village and comes back to the deck)
      c.token = c.isType(d().C.TYPE_TOKEN);
      return ret(L, c);
    });
    ddef("_Transform", (L) => {
      d().transform(card(L, 1), n(L, 2));
      return 0;
    });
    ddef("_RandomSelect", (L) => {
      const pool = [...cards(L, 1)];
      const forced = d().randomPick?.(pool, n(L, 2, 1));   // (a replay: what EDOPro picked, js/engine/replay.js)
      if (forced) return ret(L, forced);
      d().shuffle(pool);
      return ret(L, pool.slice(0, n(L, 2, 1)));
    });

    // -- Duel: questions (they yield the coroutine)
    ddef("_Select", (L) => {
      const p = n(L, 1);
      const pool = cards(L, 2);
      const mn = n(L, 3);
      const mx = n(L, 4);
      const cancel = b(L, 5);
      return rt.yieldFor(L, async () => [await d().chooseCards(p, pool, mn, mx, { cancelable: cancel }) || []],
        () => [pool.slice(0, mn)]);
    });
    ddef("_SelectTarget", (L) => {
      const p = n(L, 1);
      const pool = cards(L, 2);
      const mn = n(L, 3);
      const mx = n(L, 4);
      const mark = (picked) => {
        const duel = d();
        const link = duel.building || duel.solving;
        if (link) for (const c of picked) link.targets.push({ card: c, fieldId: c.fieldId });
        duel.emit("target", { cards: picked });
        return [picked];
      };
      return rt.yieldFor(L, async () => mark(await d().chooseCards(p, pool, mn, mx) || []), () => mark(pool.slice(0, mn)));
    });
    ddef("SelectYesNo", (L) => {
      const p = n(L, 1);
      const desc = n(L, 2);
      return rt.yieldFor(L, async () => [await d().chooseYesNo(p, desc)], () => [false]);
    });
    ddef("AnnounceNumber", (L) => {
      const p = n(L, 1);
      const numbers = [];
      for (let i = 2; i <= lua.lua_gettop(L); i++) numbers.push(n(L, i));
      return rt.yieldFor(L, async () => {
        const v = await d().chooseNumber(p, numbers);
        return [v, numbers.indexOf(v)];
      }, () => [numbers[0], 0]);
    });
  }
}
