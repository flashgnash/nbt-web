"use strict";

// ---------------------------------------------------------------- state

const $ = (id) => document.getElementById(id);

let tree = null;          // /api/tree result
let file = null;          // /api/file result (model, mutated in place)
let dirty = false;
let viewMode = "raw";     // "player" | "raw" (player only for playerdata files)
let activeRow = null;     // sidebar DOM row of the open file
const expanded = new Set(["$"]);   // editor node paths expanded
const sbOpen = new Set();          // sidebar group keys expanded

// inventory browser (player view) — reset per file
let invRootKey = null;    // which root inventory the crumb dropdown shows
let invStack = [];        // [{label, panes: [{caption, node, style}]}]
let invSel = null;        // {pane: idx, slot: n} — open item editor
let invQuery = "";        // slot fuzzy filter

// global tag-path search
let tagMatches = [];
let tagSel = -1;

const CONTAINERS = new Set(["compound", "list", "byteArray", "intArray", "longArray"]);
const NUMS = { byte: [-128n, 127n], short: [-32768n, 32767n], int: [-2147483648n, 2147483647n],
               long: [-9223372036854775808n, 9223372036854775807n] };
const TYPES = ["byte", "short", "int", "long", "float", "double", "string",
               "compound", "list", "byteArray", "intArray", "longArray"];

// Vanilla textures aren't in server jars; this CDN serves them per version.
const VANILLA_CDN = "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures";

function setStatus(msg, cls) {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = cls || "";
}

function setDirty(d) {
  dirty = d;
  if (d && file) file._paths = null;   // tag-path index is stale after edits
  $("dirty").hidden = !d;
  $("save").disabled = !d;
}

// ---------------------------------------------------------------- fuzzy

// Subsequence match; bonus for matches at word starts and adjacency.
function fuzzyScore(query, text) {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    score += (ti === last + 1) ? 3 : 1;
    if (ti === 0 || " /_-.:".includes(t[ti - 1])) score += 2;
    last = ti; qi++;
  }
  return qi === q.length ? score : -1;
}

// -------------------------------------------------------------- sidebar

function flatEntries() {
  const out = [];
  for (const s of tree.servers) {
    for (const p of s.players || [])
      for (const f of p.files)
        out.push({ label: `${s.name} / ${p.label} / ${f.label}`, sub: "player", path: f.path });
    for (const w of s.worlds) {
      out.push({ label: `${s.name} / ${w.name}`, sub: "level.dat", path: w.level });
      for (const d of w.data)
        out.push({ label: `${s.name} / ${w.name} / ${d.label}`, sub: "data", path: d.path });
    }
  }
  return out;
}

function fileRow(label, path, prefix) {
  const row = document.createElement("div");
  row.className = "node-row";
  row.dataset.path = path;
  if (prefix) {
    const pre = document.createElement("span");
    pre.className = "prefix";
    pre.textContent = prefix;
    row.appendChild(pre);
  }
  row.appendChild(document.createTextNode(label));
  row.addEventListener("click", () => openFile(path, label, row));
  if (file && file.path === path) { row.classList.add("active"); activeRow = row; }
  return row;
}

function groupRow(label, key, count, childrenEl, onOpen) {
  const row = document.createElement("div");
  row.className = "node-row";
  const caret = document.createElement("span");
  caret.className = "caret";
  row.appendChild(caret);
  row.appendChild(document.createTextNode(label));
  if (count != null) {
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = count;
    row.appendChild(c);
  }
  const sync = () => {
    const open = sbOpen.has(key);
    caret.textContent = open ? "▾" : "▸";
    childrenEl.hidden = !open;
  };
  row.addEventListener("click", () => {
    if (onOpen) {
      // player dirs: click always opens playerdata and ensures expansion;
      // a second click while already open+expanded collapses.
      if (sbOpen.has(key) && file && file.path === onOpen.path) sbOpen.delete(key);
      else sbOpen.add(key);
      sync();
      openFile(onOpen.path, onOpen.label);
      return;
    }
    sbOpen.has(key) ? sbOpen.delete(key) : sbOpen.add(key);
    sync();
  });
  sync();
  return row;
}

function renderSidebar() {
  const query = $("search").value.trim();
  const el = $("tree");
  el.textContent = "";
  activeRow = null;

  if (query) {
    const ranked = flatEntries()
      .map((e) => ({ ...e, score: fuzzyScore(query, e.label + " " + e.sub) }))
      .filter((e) => e.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
    if (!ranked.length) {
      const d = document.createElement("div");
      d.className = "group-label";
      d.textContent = "no matches";
      el.appendChild(d);
      return;
    }
    for (const e of ranked) el.appendChild(fileRow(e.label, e.path));
    return;
  }

  for (const s of tree.servers) {
    const kids = document.createElement("div");
    kids.className = "tree-indent";

    // players first, as directories of all their files on this server
    for (const p of s.players || []) {
      const pkids = document.createElement("div");
      pkids.className = "tree-indent";
      for (const f of p.files)
        pkids.appendChild(fileRow(f.label, f.path));
      const pd = p.files[0]; // playerdata is always first
      kids.appendChild(groupRow(p.label, `${s.name}/p/${p.uuid}`,
        p.files.length > 1 ? p.files.length : null, pkids,
        { path: pd.path, label: `${s.name} / ${p.label} / ${pd.label}` }));
      kids.appendChild(pkids);
    }

    for (const w of s.worlds) {
      const wkids = document.createElement("div");
      wkids.className = "tree-indent";
      wkids.appendChild(fileRow("level.dat", w.level));
      if (w.data.length) {
        const dkids = document.createElement("div");
        dkids.className = "tree-indent";
        for (const d of w.data) dkids.appendChild(fileRow(d.label, d.path));
        wkids.appendChild(groupRow("data", `${s.name}/${w.name}/d`, w.data.length, dkids));
        wkids.appendChild(dkids);
      }
      kids.appendChild(groupRow(w.name, `${s.name}/${w.name}`, null, wkids));
      kids.appendChild(wkids);
    }
    const nP = (s.players || []).length;
    el.appendChild(groupRow(s.name, s.name,
      (nP ? nP + " players · " : "") + s.worlds.length + " worlds", kids));
    el.appendChild(kids);
  }
}

// --------------------------------------------------------------- editor

function typeLabel(node) {
  if (node.t === "list") {
    const et = node.v.length ? node.v[0].t : "?";
    return `list<${et}>`;
  }
  return node.t;
}

function validateScalar(t, raw) {
  // returns parsed value or throws
  if (t === "string") return raw;
  if (t === "float" || t === "double") {
    const f = Number(raw);
    if (!isFinite(f)) throw new Error("not a number");
    return f;
  }
  let big;
  try { big = BigInt(raw.trim()); } catch { throw new Error("not an integer"); }
  const [lo, hi] = NUMS[t];
  if (big < lo || big > hi) throw new Error(`out of ${t} range`);
  return t === "long" ? big.toString() : Number(big);
}

function defaultValue(t) {
  if (t === "compound") return {};
  if (CONTAINERS.has(t)) return [];
  if (t === "string") return "";
  if (t === "long") return "0";
  return 0;
}

// Inline edit an element `span` whose committed value goes through `commit(raw)`.
function inlineEdit(span, initial, commit) {
  const input = document.createElement("input");
  input.className = "nbt-edit";
  input.value = initial;
  input.size = Math.max(6, Math.min(60, initial.length + 2));
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      try { commit(input.value); }
      catch (e) { setStatus(String(e.message || e), "err"); }
    }
    renderEditor();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") finish(true);
    if (ev.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function matchesFilter(node, key, q) {
  if (!q) return true;
  if (String(key).toLowerCase().includes(q)) return true;
  if (node.t === "compound")
    return Object.entries(node.v).some(([k, c]) => matchesFilter(c, k, q));
  if (node.t === "list")
    return node.v.some((c, i) => matchesFilter(c, i, q));
  if (!CONTAINERS.has(node.t))
    return String(node.v).toLowerCase().includes(q);
  return false;
}

// parent: {remove(), rename(newKey)} accessors, null for root
function renderNode(node, key, path, parent, q) {
  const wrap = document.createElement("div");
  wrap.className = "nbt-node";
  const row = document.createElement("div");
  row.className = "nbt-row";
  wrap.appendChild(row);

  const isContainer = CONTAINERS.has(node.t);
  const isOpen = expanded.has(path);

  const caret = document.createElement("span");
  caret.className = "nbt-caret";
  caret.textContent = isContainer ? (isOpen ? "▾" : "▸") : "";
  if (isContainer)
    caret.addEventListener("click", () => {
      isOpen ? expanded.delete(path) : expanded.add(path);
      renderEditor();
    });
  row.appendChild(caret);

  const keyEl = document.createElement("span");
  keyEl.className = "nbt-key";
  keyEl.textContent = key;
  if (parent && parent.rename) {
    keyEl.classList.add("editable");
    keyEl.title = "click to rename";
    keyEl.addEventListener("click", () =>
      inlineEdit(keyEl, String(key), (raw) => {
        if (raw !== String(key)) { parent.rename(raw); setDirty(true); }
      }));
  }
  row.appendChild(keyEl);

  const typeEl = document.createElement("span");
  typeEl.className = "nbt-type";
  typeEl.textContent = typeLabel(node);
  row.appendChild(typeEl);

  if (isContainer) {
    const n = node.t === "compound" ? Object.keys(node.v).length : node.v.length;
    const count = document.createElement("span");
    count.className = "nbt-count";
    count.textContent = `${n} ${n === 1 ? "entry" : "entries"}`;
    row.appendChild(count);
  } else {
    const val = document.createElement("span");
    val.className = "nbt-value" + (node.t === "string" ? " str" : "");
    val.textContent = String(node.v);
    val.title = "click to edit";
    val.addEventListener("click", () =>
      inlineEdit(val, String(node.v), (raw) => {
        node.v = validateScalar(node.t, raw);
        setDirty(true);
        setStatus(null);
      }));
    row.appendChild(val);
  }

  const actions = document.createElement("span");
  actions.className = "row-actions";
  if (isContainer) {
    const add = document.createElement("button");
    add.className = "mini-btn";
    add.textContent = "+";
    add.title = "add entry";
    add.addEventListener("click", () => {
      expanded.add(path);
      showAddForm(wrap, node);
    });
    actions.appendChild(add);
  }
  if (parent) {
    const del = document.createElement("button");
    del.className = "mini-btn del";
    del.textContent = "×";
    del.title = "delete";
    del.addEventListener("click", () => {
      parent.remove();
      setDirty(true);
      renderEditor();
    });
    actions.appendChild(del);
  }
  row.appendChild(actions);

  if (isContainer && isOpen) {
    const kids = document.createElement("div");
    kids.className = "nbt-children";
    if (node.t === "compound") {
      for (const k of Object.keys(node.v)) {
        if (!matchesFilter(node.v[k], k, q)) continue;
        kids.appendChild(renderNode(node.v[k], k, path + "." + k, {
          remove: () => delete node.v[k],
          rename: (nk) => {
            if (nk in node.v) throw new Error("key already exists");
            const rebuilt = {};
            for (const kk of Object.keys(node.v)) rebuilt[kk === k ? nk : kk] = node.v[kk];
            node.v = rebuilt;
          },
        }, q));
      }
    } else if (node.t === "list") {
      node.v.forEach((c, i) => {
        if (!matchesFilter(c, i, q)) return;
        kids.appendChild(renderNode(c, i, path + "[" + i + "]", {
          remove: () => node.v.splice(i, 1),
        }, q));
      });
    } else {
      // numeric arrays: render scalars of the element type
      const et = node.t === "byteArray" ? "byte" : node.t === "intArray" ? "int" : "long";
      node.v.forEach((c, i) => {
        kids.appendChild(renderNode({ t: et, get v() { return node.v[i]; },
                                      set v(x) { node.v[i] = x; } },
                                    i, path + "[" + i + "]", {
          remove: () => node.v.splice(i, 1),
        }, q));
      });
    }
    wrap.appendChild(kids);
  }
  return wrap;
}

function showAddForm(wrap, node) {
  const old = wrap.querySelector(".add-form");
  if (old) { old.remove(); renderEditor(); return; }

  const form = document.createElement("div");
  form.className = "add-form";

  let nameInput = null;
  if (node.t === "compound") {
    nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "key name";
    form.appendChild(nameInput);
  }

  let typeSel = null;
  const listEmpty = node.t === "list" && node.v.length === 0;
  if (node.t === "compound" || listEmpty) {
    typeSel = document.createElement("select");
    for (const t of TYPES) {
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      typeSel.appendChild(o);
    }
    form.appendChild(typeSel);
  }

  const ok = document.createElement("button");
  ok.className = "mini-btn";
  ok.textContent = "add";
  ok.addEventListener("click", () => {
    try {
      if (node.t === "compound") {
        const k = nameInput.value.trim();
        if (!k) throw new Error("name required");
        if (k in node.v) throw new Error("key already exists");
        const t = typeSel.value;
        node.v[k] = { t, v: defaultValue(t) };
      } else if (node.t === "list") {
        const t = listEmpty ? typeSel.value : node.v[0].t;
        node.v.push({ t, v: defaultValue(t) });
      } else {
        node.v.push(node.t === "longArray" ? "0" : 0);
      }
      setDirty(true);
      setStatus(null);
      renderEditor();
    } catch (e) { setStatus(String(e.message || e), "err"); }
  });
  form.appendChild(ok);

  const cancel = document.createElement("button");
  cancel.className = "mini-btn";
  cancel.textContent = "cancel";
  cancel.addEventListener("click", () => renderEditor());
  form.appendChild(cancel);

  wrap.appendChild(form);
  (nameInput || typeSel || ok).focus();
}

// ---------------------------------------------------------- player view
//
// Abstracted editor for playerdata files. Every widget writes straight into
// the same tagged-JSON model the raw tree renders, so the two views and the
// save path never diverge. Fields whose tag is missing are simply omitted.

const GAMEMODES = ["survival", "creative", "adventure", "spectator"];

function isPlayerFile(f) {
  return /(^|\/)playerdata\//.test(f.path) && f.root.t === "compound";
}

// server this file belongs to (first path segment) — for icon lookups
function fileServer() {
  return file ? file.path.split("/")[0] : "";
}

// the player (from the discovery tree) whose file collection contains path
function playerCtx(path) {
  if (!tree) return null;
  for (const s of tree.servers)
    for (const p of s.players || [])
      if (p.files.some((f) => f.path === path)) return { server: s, player: p };
  return null;
}

function tpath(root, path) {
  let n = root;
  for (const k of path.split(".")) {
    if (!n || n.t !== "compound") return undefined;
    n = n.v[k];
  }
  return n;
}

function dataVersion() {
  const dv = tpath(file.root, "DataVersion");
  return dv ? Number(dv.v) : 0;
}

function viewTabs() {
  const bar = document.createElement("div");
  bar.className = "view-tabs";
  for (const [id, label] of [["player", "player"], ["raw", "raw nbt"]]) {
    const t = document.createElement("div");
    t.className = "view-tab" + (viewMode === id ? " active" : "");
    t.textContent = label;
    t.addEventListener("click", () => { viewMode = id; renderEditor(); });
    bar.appendChild(t);
  }
  return bar;
}

// chip strip of every file belonging to the same player (graves, mod data…)
function playerFileTabs(ctx) {
  const bar = document.createElement("div");
  bar.className = "file-tabs";
  const who = document.createElement("span");
  who.className = "pv-label";
  who.textContent = ctx.player.label;
  bar.appendChild(who);
  for (const f of ctx.player.files) {
    const chip = document.createElement("button");
    chip.className = "pv-chip" + (f.path === file.path ? " on" : "");
    chip.textContent = f.label;
    chip.title = f.path;
    chip.addEventListener("click", () => {
      if (f.path !== file.path)
        openFile(f.path, `${ctx.server.name} / ${ctx.player.label} / ${f.label}`);
    });
    bar.appendChild(chip);
  }
  return bar;
}

function pvSection(title) {
  const s = document.createElement("div");
  s.className = "pv-section";
  const h = document.createElement("div");
  h.className = "pv-title";
  h.textContent = title;
  s.appendChild(h);
  const body = document.createElement("div");
  body.className = "pv-fields";
  s.appendChild(body);
  s.body = body;
  return s;
}

// Labelled always-visible input bound to a scalar tag node.
function pvField(body, label, node, hint, wide) {
  if (!node || CONTAINERS.has(node.t)) return;
  const f = document.createElement("label");
  f.className = "pv-field";
  const l = document.createElement("span");
  l.className = "pv-label";
  l.textContent = label;
  f.appendChild(l);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pv-input" + (wide ? " wide" : "");
  input.value = node.v;
  const commit = () => {
    if (String(node.v) === input.value.trim()) return;
    try {
      node.v = validateScalar(node.t, input.value);
      input.value = node.v;
      input.classList.remove("bad");
      setDirty(true);
      setStatus(null);
    } catch (e) {
      input.classList.add("bad");
      setStatus(label + ": " + (e.message || e), "err");
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") commit(); });
  f.appendChild(input);
  if (hint) {
    const h = document.createElement("span");
    h.className = "pv-hint";
    h.textContent = hint;
    f.appendChild(h);
  }
  body.appendChild(f);
}

// Toggle chip bound to a 0/1 byte tag.
function pvBool(body, label, node) {
  if (!node) return;
  const b = document.createElement("button");
  b.className = "pv-chip" + (node.v ? " on" : "");
  b.textContent = label;
  b.addEventListener("click", () => {
    node.v = node.v ? 0 : 1;
    b.classList.toggle("on", !!node.v);
    setDirty(true);
  });
  body.appendChild(b);
}

function pvGamemode(body, node) {
  if (!node) return;
  const f = document.createElement("label");
  f.className = "pv-field";
  const l = document.createElement("span");
  l.className = "pv-label";
  l.textContent = "gamemode";
  f.appendChild(l);
  const sel = document.createElement("select");
  sel.className = "pv-select";
  GAMEMODES.forEach((g, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = g;
    sel.appendChild(o);
  });
  if (node.v < 0 || node.v > 3) {
    const o = document.createElement("option");
    o.value = node.v;
    o.textContent = "mode " + node.v;
    sel.appendChild(o);
  }
  sel.value = node.v;
  sel.addEventListener("change", () => {
    node.v = Number(sel.value);
    setDirty(true);
  });
  f.appendChild(sel);
  body.appendChild(f);
}

// ------------------------------------------------------- potion effects

// 1.20.2 (DataVersion 3578) renamed ActiveEffects -> active_effects and
// the per-effect keys from Id/Amplifier/Duration to id/amplifier/duration.
function effectsSection() {
  const r = file.root;
  let list = tpath(r, "active_effects");
  let modern = true;
  if (!list) {
    list = tpath(r, "ActiveEffects");
    if (list) modern = false;
    else modern = dataVersion() >= 3578;
  }

  const s = pvSection("potion effects");
  const K = modern
    ? { id: "id", amp: "amplifier", dur: "duration", amb: "ambient", part: "show_particles", icon: "show_icon" }
    : { id: "Id", amp: "Amplifier", dur: "Duration", amb: "Ambient", part: "ShowParticles", icon: "ShowIcon" };

  const col = document.createElement("div");
  col.className = "effect-col";
  s.body.appendChild(col);

  (list ? list.v : []).forEach((eff, i) => {
    if (eff.t !== "compound") return;
    const row = document.createElement("div");
    row.className = "effect-row";
    pvField(row, "effect", tpath(eff, K.id), null, true);
    pvField(row, "amplifier", tpath(eff, K.amp), "0 = level I");
    pvField(row, "duration", tpath(eff, K.dur), "ticks · -1 = ∞");
    pvBool(row, "ambient", tpath(eff, K.amb));
    pvBool(row, "particles", tpath(eff, K.part));
    const del = document.createElement("button");
    del.className = "mini-btn del";
    del.textContent = "×";
    del.title = "remove effect";
    del.addEventListener("click", () => {
      list.v.splice(i, 1);
      setDirty(true);
      renderEditor();
    });
    row.appendChild(del);
    col.appendChild(row);
  });

  const add = document.createElement("button");
  add.className = "btn";
  add.textContent = "add effect";
  add.addEventListener("click", () => {
    if (!list) {
      const key = modern ? "active_effects" : "ActiveEffects";
      r.v[key] = { t: "list", v: [] };
      list = r.v[key];
    }
    list.v.push({ t: "compound", v: modern ? {
      id: { t: "string", v: "minecraft:speed" },
      amplifier: { t: "byte", v: 0 },
      duration: { t: "int", v: 1200 },
      ambient: { t: "byte", v: 0 },
      show_particles: { t: "byte", v: 1 },
      show_icon: { t: "byte", v: 1 },
    } : {
      Id: { t: "int", v: 1 },
      Amplifier: { t: "byte", v: 0 },
      Duration: { t: "int", v: 1200 },
      Ambient: { t: "byte", v: 0 },
      ShowParticles: { t: "byte", v: 1 },
      ShowIcon: { t: "byte", v: 1 },
    }});
    setDirty(true);
    renderEditor();
  });
  s.body.appendChild(add);
  return s;
}

// ------------------------------------------------- inventory browser
//
// One pane with a file-browser crumb trail. The trail starts with a dropdown
// of every root-level tag that looks like an inventory (Inventory, EnderItems,
// mod lists of item compounds). Double-clicking an item that contains
// sub-inventories (shulker component container, legacy BlockEntityTag.Items,
// modded backpacks/graves — any nested list of item-shaped compounds)
// descends into it.

function isItemCompound(n) {
  return n && n.t === "compound" && n.v.id && n.v.id.t === "string";
}

function isDirectItemList(n) {
  return n && n.t === "list" && n.v.length > 0 &&
    n.v.every((e) => e.t === "compound") && n.v.some(isItemCompound);
}

// components container style: list of {slot, item}
function isWrappedItemList(n) {
  return n && n.t === "list" && n.v.length > 0 &&
    n.v.every((e) => e.t === "compound") &&
    n.v.some((e) => isItemCompound(e.v.item));
}

const ACC = {
  direct: {
    slotOf: (e, i) => (e.v.Slot ? Number(e.v.Slot.v) : i),
    itemOf: (e) => e,
    make: (slot, id, count, ck) => ({ t: "compound", v: {
      Slot: { t: "byte", v: slot },
      id: { t: "string", v: id },
      [ck]: { t: ck === "count" ? "int" : "byte", v: count },
    }}),
  },
  wrapped: {
    slotOf: (e, i) => (e.v.slot ? Number(e.v.slot.v) : i),
    itemOf: (e) => e.v.item,
    make: (slot, id, count) => ({ t: "compound", v: {
      slot: { t: "int", v: slot },
      item: { t: "compound", v: {
        id: { t: "string", v: id },
        count: { t: "int", v: count },
      }},
    }}),
  },
};

// every nested item-list inside an item (its sub-inventories)
function findItemLists(node) {
  const out = [];
  (function walk(n, path, depth) {
    if (!n || depth > 6) return;
    if (n.t === "list") {
      if (isDirectItemList(n)) out.push({ path, node: n, style: "direct" });
      else if (isWrappedItemList(n)) out.push({ path, node: n, style: "wrapped" });
      return;
    }
    if (n.t === "compound")
      for (const k of Object.keys(n.v))
        walk(n.v[k], path ? path + "." + k : k, depth + 1);
  })(node, "", 0);
  return out;
}

function rootInventories() {
  const out = [];
  for (const [k, n] of Object.entries(file.root.v)) {
    if (n.t !== "list") continue;
    if (k === "Inventory" || k === "EnderItems" || isDirectItemList(n))
      out.push({ key: k,
                 label: k === "Inventory" ? "inventory"
                      : k === "EnderItems" ? "ender chest" : k,
                 node: n });
  }
  out.sort((a, b) =>
    (a.key === "Inventory" ? 0 : a.key === "EnderItems" ? 1 : 2) -
    (b.key === "Inventory" ? 0 : b.key === "EnderItems" ? 1 : 2) ||
    a.key.localeCompare(b.key));
  return out;
}

function currentPanes() {
  if (invStack.length) return invStack[invStack.length - 1].panes;
  const roots = rootInventories();
  const root = roots.find((r) => r.key === invRootKey) || roots[0];
  if (!root) return [];
  invRootKey = root.key;
  return [{ caption: null, node: root.node, style: "direct", rootKey: root.key }];
}

function countKeyFor(listNode, style) {
  if (style === "wrapped") return "count";
  for (const it of listNode.v) {
    if (it.t === "compound") {
      if ("count" in it.v) return "count";
      if ("Count" in it.v) return "Count";
    }
  }
  return dataVersion() >= 3837 ? "count" : "Count";
}

function shortId(id) {
  return id.startsWith("minecraft:") ? id.slice(10) : id;
}

// icon fallback chain: server mod jars -> vanilla CDN item -> CDN block -> text
function attachIcon(cell, id) {
  const [ns, name] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  const urls = [`/api/icon?server=${encodeURIComponent(fileServer())}&id=${encodeURIComponent(id)}`];
  if (ns === "minecraft")
    urls.push(`${VANILLA_CDN}/item/${name}.png`, `${VANILLA_CDN}/block/${name}.png`);
  const img = document.createElement("img");
  let i = 0;
  img.onerror = () => {
    i++;
    if (i < urls.length) img.src = urls[i];
    else { img.remove(); cell.classList.remove("has-icon"); }
  };
  img.onload = () => cell.classList.add("has-icon");
  img.src = urls[0];
  img.alt = "";
  img.draggable = false;
  cell.appendChild(img);
}

function slotCell(paneIdx, slot, entry, caption, pane) {
  const acc = ACC[pane.style];
  const item = entry ? acc.itemOf(entry) : null;
  const cell = document.createElement("div");
  const sel = invSel && invSel.pane === paneIdx && invSel.slot === slot;
  cell.className = "slot" + (item ? "" : " empty") + (sel ? " sel" : "");

  if (item) {
    const id = String(item.v.id.v);
    cell.title = id;
    if (invQuery && fuzzyScore(invQuery, shortId(id) + " " + id) < 0)
      cell.classList.add("dimmed");
    const n = document.createElement("div");
    n.className = "iname";
    n.textContent = shortId(id);
    cell.appendChild(n);
    attachIcon(cell, id);
    const cn = item.v.count || item.v.Count;
    if (cn && Number(cn.v) !== 1) {
      const c = document.createElement("div");
      c.className = "icount";
      c.textContent = cn.v;
      cell.appendChild(c);
    }
    const subs = findItemLists(item);
    if (subs.length) {
      cell.classList.add("has-sub");
      cell.title = id + " — double-click to open contents";
      const m = document.createElement("div");
      m.className = "isub";
      m.textContent = "▸";
      cell.appendChild(m);
      cell.addEventListener("dblclick", () => {
        invStack.push({
          label: shortId(id),
          panes: subs.map((sub) => ({ caption: sub.path, node: sub.node, style: sub.style })),
        });
        invSel = null;
        renderEditor();
      });
    }
  } else {
    cell.title = caption ? caption + " (empty)" : "empty — click to add";
    if (caption) {
      const c = document.createElement("div");
      c.className = "icap";
      c.textContent = caption;
      cell.appendChild(c);
    }
  }

  cell.addEventListener("click", () => {
    invSel = sel ? null : { pane: paneIdx, slot };
    renderEditor();
  });
  return cell;
}

function itemEditor(paneIdx, pane) {
  const acc = ACC[pane.style];
  const slot = invSel.slot;
  const idx = pane.node.v.findIndex((e, i) => acc.slotOf(e, i) === slot);
  const entry = idx >= 0 ? pane.node.v[idx] : null;
  const item = entry ? acc.itemOf(entry) : null;

  const ed = document.createElement("div");
  ed.className = "item-edit";

  const slotLabel = document.createElement("span");
  slotLabel.className = "pv-label";
  slotLabel.textContent = "slot " + slot;
  ed.appendChild(slotLabel);

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.className = "pv-input wide";
  idInput.placeholder = "minecraft:diamond";
  idInput.value = item ? String(item.v.id.v) : "";
  ed.appendChild(idInput);

  const cInput = document.createElement("input");
  cInput.type = "text";
  cInput.className = "pv-input count";
  cInput.value = item ? String((item.v.count || item.v.Count)?.v ?? 1) : "1";
  ed.appendChild(cInput);

  const apply = document.createElement("button");
  apply.className = "btn primary";
  apply.textContent = item ? "apply" : "add";
  apply.addEventListener("click", () => {
    try {
      let id = idInput.value.trim();
      if (!id) throw new Error("item id required");
      if (!id.includes(":")) id = "minecraft:" + id;
      const count = Number(cInput.value);
      if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");
      const ck = countKeyFor(pane.node, pane.style);
      if (item) {
        item.v.id.v = id;
        const cn = item.v.count || item.v.Count;
        if (cn) cn.v = count;
        else item.v[ck] = { t: ck === "count" ? "int" : "byte", v: count };
      } else {
        pane.node.v.push(acc.make(slot, id, count, ck));
      }
      setDirty(true);
      setStatus(null);
      renderEditor();
    } catch (e) { setStatus(String(e.message || e), "err"); }
  });
  ed.appendChild(apply);

  if (entry) {
    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      pane.node.v.splice(idx, 1);
      invSel = null;
      setDirty(true);
      renderEditor();
    });
    ed.appendChild(del);
  }

  const note = document.createElement("span");
  note.className = "pv-hint";
  note.textContent = item ? "enchantments & other item data are preserved — edit them in raw nbt" : "";
  ed.appendChild(note);
  return ed;
}

const ARMOR_SLOTS = [
  [103, "head"], [102, "chest"], [101, "legs"], [100, "feet"], [-106, "offhand"],
];

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => [a + i, null]);
}

function paneLayout(pane, bySlot) {
  if (pane.rootKey === "Inventory")
    return [
      { slots: ARMOR_SLOTS },
      { slots: range(9, 17), gap: true },
      { slots: range(18, 26) },
      { slots: range(27, 35) },
      { slots: range(0, 8), gap: true },   // hotbar
    ];
  const maxSlot = Math.max(26, ...bySlot.keys());
  const rows = [];
  if (maxSlot <= 53)
    for (let a = 0; a <= maxSlot; a += 9)
      rows.push({ slots: range(a, Math.min(a + 8, maxSlot)) });
  else
    for (let a = 0; a <= 26; a += 9)
      rows.push({ slots: range(a, a + 8) });
  return rows;
}

function crumbBar() {
  const bar = document.createElement("div");
  bar.className = "crumb-bar";

  const roots = rootInventories();
  const sel = document.createElement("select");
  sel.className = "pv-select";
  for (const r of roots) {
    const o = document.createElement("option");
    o.value = r.key;
    o.textContent = r.label;
    sel.appendChild(o);
  }
  sel.value = invRootKey || (roots[0] && roots[0].key) || "";
  sel.addEventListener("change", () => {
    invRootKey = sel.value;
    invStack = [];
    invSel = null;
    renderEditor();
  });
  bar.appendChild(sel);

  invStack.forEach((level, i) => {
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    bar.appendChild(sep);
    const seg = document.createElement("button");
    seg.className = "crumb" + (i === invStack.length - 1 ? " here" : "");
    seg.textContent = level.label;
    seg.addEventListener("click", () => {
      invStack.length = i + 1;
      invSel = null;
      renderEditor();
    });
    bar.appendChild(seg);
  });

  const spacer = document.createElement("span");
  spacer.className = "crumb-spacer";
  bar.appendChild(spacer);

  const search = document.createElement("input");
  search.type = "text";
  search.className = "pv-input";
  search.placeholder = "find item…";
  search.value = invQuery;
  search.addEventListener("input", () => {
    invQuery = search.value.trim();
    const editor = $("editor");
    for (const cell of editor.querySelectorAll(".slot")) {
      const id = cell.title.split(" ")[0];
      cell.classList.toggle("dimmed",
        !!invQuery && !cell.classList.contains("empty") &&
        fuzzyScore(invQuery, shortId(id) + " " + id) < 0);
    }
  });
  bar.appendChild(search);
  return bar;
}

function inventorySection() {
  const s = pvSection("items");
  s.body.classList.add("inv-body");
  const panes = currentPanes();
  if (!panes.length) {
    const d = document.createElement("div");
    d.className = "pv-hint";
    d.textContent = "no inventory tags in this file";
    s.body.appendChild(d);
    return s;
  }
  s.body.appendChild(crumbBar());

  panes.forEach((pane, paneIdx) => {
    if (pane.caption) {
      const cap = document.createElement("div");
      cap.className = "pane-cap";
      cap.textContent = pane.caption;
      s.body.appendChild(cap);
    }
    const bySlot = new Map();
    pane.node.v.forEach((e, i) => bySlot.set(ACC[pane.style].slotOf(e, i), e));

    const col = document.createElement("div");
    col.className = "inv-col";
    const layout = paneLayout(pane, bySlot);
    for (const row of layout) {
      const r = document.createElement("div");
      r.className = "inv-row" + (row.gap ? " gap" : "");
      for (const cell of row.slots)
        r.appendChild(slotCell(paneIdx, cell[0], bySlot.get(cell[0]), cell[1], pane));
      col.appendChild(r);
    }
    const drawn = new Set(layout.flatMap((r) => r.slots.map((c) => c[0])));
    const extras = [...bySlot.keys()].filter((n) => !drawn.has(n)).sort((a, b) => a - b);
    if (extras.length) {
      const r = document.createElement("div");
      r.className = "inv-row gap";
      for (const n of extras)
        r.appendChild(slotCell(paneIdx, n, bySlot.get(n), "slot " + n, pane));
      col.appendChild(r);
    }
    s.body.appendChild(col);

    if (invSel && invSel.pane === paneIdx)
      s.body.appendChild(itemEditor(paneIdx, pane));
  });
  return s;
}

function renderPlayerView() {
  const r = file.root;
  const v = document.createElement("div");
  v.className = "player-view";

  const vit = pvSection("vitals");
  pvField(vit.body, "health", tpath(r, "Health"), "20 = full");
  pvField(vit.body, "food", tpath(r, "foodLevel"), "/ 20");
  pvField(vit.body, "saturation", tpath(r, "foodSaturationLevel"));
  pvField(vit.body, "air", tpath(r, "Air"), "/ 300");
  pvField(vit.body, "fire", tpath(r, "Fire"), "-20 = off");
  pvField(vit.body, "absorption", tpath(r, "AbsorptionAmount"));
  pvGamemode(vit.body, tpath(r, "playerGameType"));
  v.appendChild(vit);

  const xp = pvSection("experience");
  pvField(xp.body, "level", tpath(r, "XpLevel"));
  pvField(xp.body, "progress", tpath(r, "XpP"), "0 – 1");
  pvField(xp.body, "total", tpath(r, "XpTotal"));
  pvField(xp.body, "score", tpath(r, "Score"));
  v.appendChild(xp);

  const pos = pvSection("position");
  const p = tpath(r, "Pos");
  if (p && p.t === "list" && p.v.length === 3) {
    pvField(pos.body, "x", p.v[0]);
    pvField(pos.body, "y", p.v[1]);
    pvField(pos.body, "z", p.v[2]);
  }
  const rot = tpath(r, "Rotation");
  if (rot && rot.t === "list" && rot.v.length === 2) {
    pvField(pos.body, "yaw", rot.v[0]);
    pvField(pos.body, "pitch", rot.v[1]);
  }
  pvField(pos.body, "dimension", tpath(r, "Dimension"), null, true);
  pvField(pos.body, "spawn x", tpath(r, "SpawnX"));
  pvField(pos.body, "spawn y", tpath(r, "SpawnY"));
  pvField(pos.body, "spawn z", tpath(r, "SpawnZ"));
  v.appendChild(pos);

  const ab = pvSection("abilities");
  pvBool(ab.body, "invulnerable", tpath(r, "abilities.invulnerable"));
  pvBool(ab.body, "may fly", tpath(r, "abilities.mayfly"));
  pvBool(ab.body, "flying", tpath(r, "abilities.flying"));
  pvBool(ab.body, "instabuild", tpath(r, "abilities.instabuild"));
  pvBool(ab.body, "may build", tpath(r, "abilities.mayBuild"));
  pvField(ab.body, "walk speed", tpath(r, "abilities.walkSpeed"));
  pvField(ab.body, "fly speed", tpath(r, "abilities.flySpeed"));
  v.appendChild(ab);

  v.appendChild(effectsSection());
  v.appendChild(inventorySection());
  return v;
}

// ------------------------------------------------------ tag path search
//
// Global fuzzy find over every scalar tag path in the open file; Enter on a
// match turns the row into an inline value editor.

function collectPaths() {
  if (file._paths) return file._paths;
  const out = [];
  (function walk(n, label) {
    if (out.length > 100000) return;
    if (n.t === "compound") {
      for (const k of Object.keys(n.v)) walk(n.v[k], label ? label + " / " + k : k);
    } else if (n.t === "list") {
      if (n.v.length <= 1000) n.v.forEach((c, i) => walk(c, label + " / " + i));
    } else if (!CONTAINERS.has(n.t)) {
      out.push({ label, node: n });
    }
  })(file.root, "");
  file._paths = out;
  return out;
}

function closeTagSearch() {
  $("tagresults").hidden = true;
  tagMatches = [];
  tagSel = -1;
}

function renderTagResults() {
  const box = $("tagresults");
  box.textContent = "";
  if (!tagMatches.length) { box.hidden = true; return; }
  box.hidden = false;
  tagMatches.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "tag-row" + (i === tagSel ? " sel" : "");
    const pathEl = document.createElement("span");
    pathEl.className = "tag-path";
    pathEl.textContent = m.label;
    row.appendChild(pathEl);
    const val = document.createElement("span");
    val.className = "tag-val";
    val.textContent = String(m.node.v);
    row.appendChild(val);
    const type = document.createElement("span");
    type.className = "nbt-type";
    type.textContent = m.node.t;
    row.appendChild(type);
    row.addEventListener("click", () => { tagSel = i; editTagRow(); });
    box.appendChild(row);
  });
}

function editTagRow() {
  const box = $("tagresults");
  const row = box.children[tagSel];
  const m = tagMatches[tagSel];
  if (!row || !m) return;
  const val = row.querySelector(".tag-val");
  const input = document.createElement("input");
  input.className = "nbt-edit";
  input.value = String(m.node.v);
  val.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      try {
        m.node.v = validateScalar(m.node.t, input.value);
        setDirty(true);
        setStatus("set " + m.label + " = " + m.node.v, "ok");
        closeTagSearch();
        $("tagsearch").value = "";
        renderEditor();
        return;
      } catch (e) { setStatus(String(e.message || e), "err"); }
    }
    renderTagResults();
    $("tagsearch").focus();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.stopPropagation(); finish(true); }
    if (ev.key === "Escape") { ev.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(false));
}

function onTagSearchInput() {
  if (!file) return;
  const q = $("tagsearch").value.trim();
  if (!q) { closeTagSearch(); return; }
  tagMatches = collectPaths()
    .map((e) => ({ ...e, score: fuzzyScore(q, e.label) }))
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  tagSel = tagMatches.length ? 0 : -1;
  renderTagResults();
}

// --------------------------------------------------------------- editor

function renderEditor() {
  const el = $("editor");
  el.textContent = "";
  if (!file) {
    const d = document.createElement("div");
    d.id = "empty";
    d.className = "dim";
    d.textContent = "Pick a player, world or data file on the left.";
    el.appendChild(d);
    return;
  }
  const ctx = playerCtx(file.path);
  if (ctx && ctx.player.files.length > 1) el.appendChild(playerFileTabs(ctx));
  const player = isPlayerFile(file);
  $("filter").hidden = player && viewMode === "player";
  if (player) el.appendChild(viewTabs());
  if (player && viewMode === "player") {
    el.appendChild(renderPlayerView());
    return;
  }
  const q = $("filter").value.trim().toLowerCase();
  el.appendChild(renderNode(file.root, file.rootName || "(root)", "$", null, q));
}

// ----------------------------------------------------------------- I/O

async function api(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function openFile(path, label, row) {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  try {
    setStatus("loading…");
    file = await api("/api/file?path=" + encodeURIComponent(path));
    expanded.clear();
    expanded.add("$");
    viewMode = isPlayerFile(file) ? "player" : "raw";
    invRootKey = null;
    invStack = [];
    invSel = null;
    invQuery = "";
    closeTagSearch();
    $("tagsearch").value = "";
    $("tagsearch").hidden = false;
    setDirty(false);
    setStatus(null);
    $("filelabel").textContent = label || path;
    $("filelabel").classList.remove("dim");
    history.replaceState(null, "", "#path=" + encodeURIComponent(path));
    $("filter").hidden = false;
    $("reload").disabled = false;
    if (activeRow) activeRow.classList.remove("active");
    if (!row) {
      row = $("tree").querySelector(`[data-path="${CSS.escape(path)}"]`) || undefined;
    }
    if (row) { row.classList.add("active"); activeRow = row; }
    renderEditor();
  } catch (e) {
    setStatus("open failed: " + e.message, "err");
  }
}

async function saveFile() {
  if (!file || !dirty) return;
  try {
    setStatus("saving…");
    const r = await api("/api/file?path=" + encodeURIComponent(file.path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: file.root }),
    });
    setDirty(false);
    setStatus("saved (backup: " + r.backup + ")", "ok");
  } catch (e) {
    setStatus("save failed: " + e.message, "err");
  }
}

async function reloadFile() {
  if (!file) return;
  if (dirty && !confirm("Discard unsaved changes and reload from disk?")) return;
  const path = file.path, label = $("filelabel").textContent;
  setDirty(false);
  await openFile(path, label, activeRow);
}

// ---------------------------------------------------------------- init

$("search").addEventListener("input", renderSidebar);
$("filter").addEventListener("input", renderEditor);
$("save").addEventListener("click", saveFile);
$("reload").addEventListener("click", reloadFile);

$("tagsearch").addEventListener("input", onTagSearchInput);
$("tagsearch").addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); if (tagSel < tagMatches.length - 1) { tagSel++; renderTagResults(); } }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); if (tagSel > 0) { tagSel--; renderTagResults(); } }
  else if (ev.key === "Enter" && tagSel >= 0) { ev.preventDefault(); editTagRow(); }
  else if (ev.key === "Escape") { closeTagSearch(); $("tagsearch").blur(); }
});
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("#tagresults") && ev.target !== $("tagsearch")) closeTagSearch();
});

document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
    ev.preventDefault();
    saveFile();
  }
});
window.addEventListener("beforeunload", (ev) => {
  if (dirty) ev.preventDefault();
});

(async () => {
  try {
    setStatus("loading server tree…");
    tree = await api("/api/tree");
    setStatus(null);
    for (const s of tree.servers) sbOpen.add(s.name);
    renderSidebar();
    // deep link: #path=<relative path> opens that file directly
    const m = location.hash.match(/^#path=(.+)$/);
    if (m) await openFile(decodeURIComponent(m[1]));
  } catch (e) {
    setStatus("failed to load server tree: " + e.message, "err");
  }
})();
