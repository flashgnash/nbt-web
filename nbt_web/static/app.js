"use strict";

// ---------------------------------------------------------------- state

const $ = (id) => document.getElementById(id);

let tree = null;          // /api/tree result
let file = null;          // /api/file result (model, mutated in place)
let dirty = false;
let activeRow = null;     // sidebar DOM row of the open file
const expanded = new Set(["$"]);   // editor node paths expanded
const sbOpen = new Set();          // sidebar group keys expanded

const CONTAINERS = new Set(["compound", "list", "byteArray", "intArray", "longArray"]);
const NUMS = { byte: [-128n, 127n], short: [-32768n, 32767n], int: [-2147483648n, 2147483647n],
               long: [-9223372036854775808n, 9223372036854775807n] };
const TYPES = ["byte", "short", "int", "long", "float", "double", "string",
               "compound", "list", "byteArray", "intArray", "longArray"];

function setStatus(msg, cls) {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = cls || "";
}

function setDirty(d) {
  dirty = d;
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
    if (ti === 0 || " /_-.".includes(t[ti - 1])) score += 2;
    last = ti; qi++;
  }
  return qi === q.length ? score : -1;
}

// -------------------------------------------------------------- sidebar

function flatEntries() {
  const out = [];
  for (const s of tree.servers) {
    for (const w of s.worlds) {
      out.push({ label: `${s.name} / ${w.name}`, sub: "level.dat", path: w.level });
      for (const p of w.players)
        out.push({ label: `${s.name} / ${w.name} / ${p.label}`, sub: "player", path: p.path });
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

function groupRow(label, key, count, childrenEl) {
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
    for (const w of s.worlds) {
      const wkids = document.createElement("div");
      wkids.className = "tree-indent";
      wkids.appendChild(fileRow("level.dat", w.level));
      if (w.players.length) {
        const pkids = document.createElement("div");
        pkids.className = "tree-indent";
        for (const p of w.players) pkids.appendChild(fileRow(p.label, p.path));
        wkids.appendChild(groupRow("players", `${s.name}/${w.name}/p`, w.players.length, pkids));
        wkids.appendChild(pkids);
      }
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
    el.appendChild(groupRow(s.name, s.name, s.worlds.length + " worlds", kids));
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

function scalarDisplay(node) {
  return String(node.v);
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

// parent: {get(), set(v), remove(), rename(newKey)} accessors, null for root
function renderNode(node, key, path, parent, q) {
  const wrap = document.createElement("div");
  wrap.className = "nbt-node";
  const row = document.createElement("div");
  row.className = "nbt-row";
  wrap.appendChild(row);

  const isContainer = CONTAINERS.has(node.t);
  const isOpen = expanded.has(path);

  // caret
  const caret = document.createElement("span");
  caret.className = "nbt-caret";
  caret.textContent = isContainer ? (isOpen ? "▾" : "▸") : "";
  if (isContainer)
    caret.addEventListener("click", () => {
      isOpen ? expanded.delete(path) : expanded.add(path);
      renderEditor();
    });
  row.appendChild(caret);

  // key
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

  // type badge
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
    val.textContent = scalarDisplay(node);
    val.title = "click to edit";
    val.addEventListener("click", () =>
      inlineEdit(val, String(node.v), (raw) => {
        node.v = validateScalar(node.t, raw);
        setDirty(true);
        setStatus(null);
      }));
    row.appendChild(val);
  }

  // actions
  const actions = document.createElement("span");
  actions.className = "row-actions";
  if (node.t === "compound" || node.t === "list" ||
      node.t === "byteArray" || node.t === "intArray" || node.t === "longArray") {
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

  // children
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

function renderEditor() {
  const el = $("editor");
  el.textContent = "";
  if (!file) {
    const d = document.createElement("div");
    d.id = "empty";
    d.className = "dim";
    d.textContent = "Pick a world, player or data file on the left.";
    el.appendChild(d);
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
    setDirty(false);
    setStatus(null);
    $("filelabel").textContent = label || path;
    $("filelabel").classList.remove("dim");
    $("filter").hidden = false;
    $("reload").disabled = false;
    if (activeRow) activeRow.classList.remove("active");
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
    tree = await api("/api/tree");
    for (const s of tree.servers) sbOpen.add(s.name);
    renderSidebar();
  } catch (e) {
    setStatus("failed to load server tree: " + e.message, "err");
  }
})();
