#!/usr/bin/env python3
"""nbt-web — web-based NBT editor for a directory of minecraft servers.

Serves a small JSON API plus a static single-page frontend:

  GET /api/tree          discovered servers -> worlds -> players/data files
  GET /api/file?path=R   NBT file at R (relative to root) as tagged JSON
  PUT /api/file?path=R   write edited tagged JSON back (rolling .nbtweb.bak)

Only *.dat / *.dat_old / *.nbt files inside the root are ever touched.
"""

import argparse
import gzip
import json
import os
import re
import shutil
import ssl
import sys
import tempfile
import threading
import time
import zipfile
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import nbtlib
from nbtlib import tag as T

ROOT: Path = Path("/srv/minecraft")
STATIC: Path = Path(os.environ.get("NBT_WEB_STATIC", Path(__file__).parent / "static"))

NBT_EXTS = {".dat", ".dat_old", ".nbt"}

# Directories never worth descending into — either NBT-free or huge
# (mod jars, logs, packwiz caches, and above all the region/entity/poi
# dirs, which hold tens of thousands of .mca files and no .dat).
PRUNE = {
    ".git", ".cache", "advancements", "backups", "bluemap", "bundler", "cache",
    "config", "crash-reports", "datapacks", "defaultconfigs", "dynmap",
    "entities", "generated", "journeymap", "kubejs", "libraries", "logs",
    "mods", "node_modules", "packwiz", "plugins", "poi", "region",
    "resourcepacks", "scripts", "shaderpacks", "stats", "structures",
    "versions",
}

_write_lock = threading.Lock()


# ---------------------------------------------------------------- discovery

def _load_usercache(server_dir: Path) -> dict:
    """uuid (lowercase) -> last-known player name, from usercache.json."""
    try:
        entries = json.loads((server_dir / "usercache.json").read_text())
        return {e["uuid"].lower(): e["name"] for e in entries if "uuid" in e and "name" in e}
    except (OSError, ValueError, TypeError):
        return {}


def _find_worlds(server_dir: Path, depth: int = 2):
    """Dirs containing a level.dat, up to `depth` levels below the server dir."""
    found = []

    def walk(d: Path, left: int):
        try:
            children = sorted(d.iterdir())
        except OSError:
            return
        if (d / "level.dat").is_file():
            found.append(d)
            # nether/end live beside, not inside, a world — no need to recurse
            return
        if left == 0:
            return
        for c in children:
            if c.is_dir() and not c.is_symlink() and c.name not in PRUNE and not c.name.startswith("."):
                walk(c, left - 1)

    walk(server_dir, depth)
    return found


def _rel(p: Path) -> str:
    return str(p.relative_to(ROOT))


def _walk_dats(server_dir: Path, max_depth: int = 6):
    """Every .dat/.dat_old under the server dir (pruned, symlink-following).

    Directory symlinks ARE followed — hosting setups routinely symlink
    ``playerdata`` (and whole worlds) to a shared store, and skipping them made
    those files invisible. A realpath visited-set stops symlink loops, PRUNE +
    ``max_depth`` keep the walk bounded.
    """
    out = []
    seen = set()

    def walk(d, depth: int):
        if depth > max_depth:
            return
        try:
            real = os.path.realpath(d)
        except OSError:
            return
        if real in seen:
            return
        seen.add(real)
        try:
            with os.scandir(d) as it:
                for e in it:
                    if e.name.startswith("."):
                        continue
                    if e.is_dir(follow_symlinks=True):
                        if e.name in PRUNE:
                            continue
                        walk(e.path, depth + 1)
                    elif e.name.endswith((".dat", ".dat_old")):
                        out.append(Path(e.path))
        except OSError:
            return

    walk(server_dir, 0)
    out.sort()
    return out


def discover_tree() -> dict:
    servers = []
    try:
        server_dirs = sorted(d for d in ROOT.iterdir() if d.is_dir() and not d.name.startswith("."))
    except OSError:
        server_dirs = []
    for sd in server_dirs:
        names = _load_usercache(sd)
        dats = _walk_dats(sd)

        # Players are first-class: their playerdata plus every other .dat in
        # the server whose filename carries their uuid (dashed or not) or
        # username — tombstone graves, cosmetic armour, mod attachments, ...
        players = {}
        for f in dats:
            if f.parent.name == "playerdata" and f.suffix == ".dat":
                uuid = f.stem
                players[uuid] = {
                    "uuid": uuid,
                    "label": names.get(uuid.lower(), uuid),
                    "files": [{"label": "playerdata", "path": _rel(f)}],
                }
        for uuid, ent in players.items():
            keys = {uuid.lower(), uuid.replace("-", "").lower()}
            if ent["label"] != uuid:
                keys.add(ent["label"].lower())
            for f in dats:
                if f.parent.name == "playerdata" and f.suffix == ".dat":
                    continue
                if not any(k in f.stem.lower() for k in keys):
                    continue
                label = f.parent.name if f.parent != sd else f.stem
                if f.suffix == ".dat_old":
                    label += " (old)"
                if any(x["label"] == label for x in ent["files"]):
                    n = 2
                    while any(x["label"] == f"{label} {n}" for x in ent["files"]):
                        n += 1
                    label = f"{label} {n}"
                ent["files"].append({"label": label, "path": _rel(f)})
            ent["files"][1:] = sorted(ent["files"][1:], key=lambda x: x["label"])

        worlds = []
        for wd in _find_worlds(sd):
            data = []
            ddir = wd / "data"
            if ddir.is_dir():
                data = [{"label": f.name, "path": _rel(f)} for f in sorted(ddir.glob("*.dat"))]
            # The raw playerdata dir is listed directly (not via the player
            # heuristic) so its files always stay browsable in the tree even
            # when they don't map into the nicer per-player abstraction — e.g.
            # a Folia world whose players never got matched. A targeted glob
            # also dodges the whole-tree walk aborting early on an unreadable
            # sibling dir.
            pdata = []
            pddir = wd / "playerdata"
            if pddir.is_dir():
                for f in sorted([*pddir.glob("*.dat"), *pddir.glob("*.dat_old")]):
                    label = names.get(f.stem.lower(), f.stem)
                    if f.suffix == ".dat_old":
                        label += " (old)"
                    pdata.append({"label": label, "path": _rel(f)})
            worlds.append({
                "name": str(wd.relative_to(sd)),
                "level": _rel(wd / "level.dat"),
                "data": data,
                "playerdata": pdata,
            })
        if worlds or players:
            servers.append({
                "name": sd.name,
                "players": sorted(players.values(), key=lambda p: p["label"].lower()),
                "worlds": worlds,
            })

    # Most recently active server first — a running/recently booted server
    # keeps its level.dat fresh.
    def recency(s):
        m = 0.0
        for w in s["worlds"]:
            try:
                m = max(m, (ROOT / w["level"]).stat().st_mtime)
            except OSError:
                pass
        return m

    servers.sort(key=recency, reverse=True)
    return {"root": str(ROOT), "servers": servers}


# The tree walk touches a lot of disk on a busy hosting box, so requests are
# served from an in-memory cache: the first build happens at startup (and
# blocks only the unlucky first request if it beats the warm-up), afterwards
# a stale cache answers instantly while a background thread refreshes it.

TREE_TTL = 30.0
_tree_cache = {"data": None, "ts": 0.0, "building": False}
_tree_lock = threading.Lock()


def _rebuild_tree():
    try:
        data = discover_tree()
    except Exception:
        data = None
    with _tree_lock:
        if data is not None:
            _tree_cache["data"] = data
            _tree_cache["ts"] = time.time()
        _tree_cache["building"] = False


def get_tree() -> dict:
    with _tree_lock:
        cached = _tree_cache["data"]
        stale = time.time() - _tree_cache["ts"] > TREE_TTL
        if cached is not None:
            if stale and not _tree_cache["building"]:
                _tree_cache["building"] = True
                threading.Thread(target=_rebuild_tree, daemon=True).start()
            return cached
    # no cache yet (request beat the startup warm-up): build synchronously
    data = discover_tree()
    with _tree_lock:
        _tree_cache["data"] = data
        _tree_cache["ts"] = time.time()
    return data


def _prewarm():
    _rebuild_tree()
    with _tree_lock:
        data = _tree_cache["data"]
    servers = (data or {}).get("servers", [])
    # parse + cache every player's <uuid>.dat so opening a player is instant
    warmed = 0
    for s in servers:
        for pl in s.get("players", []):
            for fe in pl.get("files", []):
                if fe["label"] != "playerdata":
                    continue
                try:
                    read_nbt(fe["path"])
                    warmed += 1
                except ApiError:
                    pass
    if warmed:
        print(f"nbt-web warmed {warmed} playerdata file(s)", flush=True)
    # icon indexes warm in tree order = most recently active server first
    for s in servers:
        sd = ROOT / s["name"]
        if sd.is_dir():
            _icon_index(sd)


# ---------------------------------------------------------- NBT <-> JSON

# Longs travel as strings: JS numbers lose precision past 2^53.

def tag_to_json(tag):
    if isinstance(tag, T.Compound):
        return {"t": "compound", "v": {k: tag_to_json(v) for k, v in tag.items()}}
    if isinstance(tag, T.ByteArray):
        return {"t": "byteArray", "v": [int(x) for x in tag]}
    if isinstance(tag, T.IntArray):
        return {"t": "intArray", "v": [int(x) for x in tag]}
    if isinstance(tag, T.LongArray):
        return {"t": "longArray", "v": [str(int(x)) for x in tag]}
    if isinstance(tag, T.List):
        return {"t": "list", "v": [tag_to_json(x) for x in tag]}
    if isinstance(tag, T.Byte):
        return {"t": "byte", "v": int(tag)}
    if isinstance(tag, T.Short):
        return {"t": "short", "v": int(tag)}
    if isinstance(tag, T.Int):
        return {"t": "int", "v": int(tag)}
    if isinstance(tag, T.Long):
        return {"t": "long", "v": str(int(tag))}
    if isinstance(tag, T.Float):
        return {"t": "float", "v": float(tag)}
    if isinstance(tag, T.Double):
        return {"t": "double", "v": float(tag)}
    if isinstance(tag, T.String):
        return {"t": "string", "v": str(tag)}
    raise ValueError(f"unsupported tag type: {type(tag).__name__}")


def json_to_tag(j):
    t, v = j["t"], j["v"]
    if t == "compound":
        return T.Compound({k: json_to_tag(x) for k, x in v.items()})
    if t == "list":
        return T.List([json_to_tag(x) for x in v])
    if t == "byteArray":
        return T.ByteArray([int(x) for x in v])
    if t == "intArray":
        return T.IntArray([int(x) for x in v])
    if t == "longArray":
        return T.LongArray([int(x) for x in v])
    if t == "byte":
        return T.Byte(int(v))
    if t == "short":
        return T.Short(int(v))
    if t == "int":
        return T.Int(int(v))
    if t == "long":
        return T.Long(int(v))
    if t == "float":
        return T.Float(float(v))
    if t == "double":
        return T.Double(float(v))
    if t == "string":
        return T.String(str(v))
    raise ValueError(f"unsupported tag type: {t}")


# ---------------------------------------------------------------- file I/O

class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def _safe_path(rel: str) -> Path:
    p = (ROOT / rel).resolve()
    root = ROOT.resolve()
    if root not in p.parents:
        raise ApiError(400, "path escapes the configured root")
    if p.suffix not in NBT_EXTS:
        raise ApiError(400, f"not an NBT file extension: {p.suffix}")
    return p


# Parsed NBT is cached in memory so re-opening a file is instant. Playerdata
# (the per-player <uuid>.dat files) is warmed at boot; anything else is cached
# lazily as it is read or prefetched. The cache is a bounded LRU so memory
# stays in check no matter how many files get touched — the least-recently
# used entry is evicted once the cap is reached. Entries are keyed by relative
# path and validated against (mtime, size) so an external edit is picked up,
# and are dropped on our own writes/restores.

FILE_CACHE_MAX = 512
_file_cache = OrderedDict()   # rel -> ((mtime, size), data dict)  [LRU order]
_file_cache_lock = threading.Lock()


def _is_playerdata(p: Path) -> bool:
    return p.parent.name == "playerdata" and p.suffix == ".dat"


def _parse_nbt(p: Path, rel: str) -> dict:
    try:
        f = nbtlib.load(str(p))
    except Exception as e:  # corrupt / not actually NBT
        raise ApiError(422, f"failed to parse NBT: {e}")
    return {
        "path": rel,
        "gzipped": bool(getattr(f, "gzipped", True)),
        "rootName": getattr(f, "root_name", "") or "",
        "root": tag_to_json(T.Compound(dict(f))),
    }


def _invalidate_cache(rel: str):
    with _file_cache_lock:
        _file_cache.pop(rel, None)


def read_nbt(rel: str) -> dict:
    p = _safe_path(rel)
    if not p.is_file():
        raise ApiError(404, "no such file")
    st = p.stat()
    stamp = (st.st_mtime, st.st_size)
    with _file_cache_lock:
        c = _file_cache.get(rel)
        if c is not None and c[0] == stamp:
            _file_cache.move_to_end(rel)
            return c[1]
    data = _parse_nbt(p, rel)
    with _file_cache_lock:
        _file_cache[rel] = (stamp, data)
        _file_cache.move_to_end(rel)
        while len(_file_cache) > FILE_CACHE_MAX:
            _file_cache.popitem(last=False)
    return data


def write_nbt(rel: str, payload: dict) -> dict:
    p = _safe_path(rel)
    if not p.is_file():
        raise ApiError(404, "no such file")
    try:
        new_root = json_to_tag(payload["root"])
    except (KeyError, ValueError, TypeError) as e:
        raise ApiError(400, f"bad NBT payload: {e}")
    if not isinstance(new_root, T.Compound):
        raise ApiError(400, "root must be a compound")

    with _write_lock:
        # Reload so File metadata (gzipped, byteorder, root name) is preserved
        # exactly; then swap the contents and save via a temp file + rename.
        try:
            f = nbtlib.load(str(p))
        except Exception as e:
            raise ApiError(422, f"failed to re-parse target before write: {e}")
        f.clear()
        f.update(new_root)

        shutil.copy2(p, p.with_name(p.name + ".nbtweb.bak"))
        fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", dir=str(p.parent))
        os.close(fd)
        try:
            f.save(tmp)
            shutil.copymode(p, tmp)
            os.replace(tmp, p)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    _invalidate_cache(rel)
    return {"ok": True, "backup": p.name + ".nbtweb.bak"}


# ---------------------------------------------------------------- backups
#
# Named on-demand backups (separate from the rolling .nbtweb.bak the save
# path keeps): stored under <root>/.nbtweb-backups/<relpath>/<timestamp>.
# The dot-dir keeps them out of discovery. Restoring first snapshots the
# current state as a "-pre" backup so a restore is always reversible.

BACKUP_DIR = ".nbtweb-backups"
BAK_NAME_RE = re.compile(r"^[0-9]{8}-[0-9]{6}(-pre)?\.[A-Za-z_]+$")


def make_backup(rel: str, pre: bool = False) -> dict:
    p = _safe_path(rel)
    if not p.is_file():
        raise ApiError(404, "no such file")
    d = ROOT / BACKUP_DIR / rel
    d.mkdir(parents=True, exist_ok=True)
    name = time.strftime("%Y%m%d-%H%M%S") + ("-pre" if pre else "") + p.suffix
    shutil.copy2(p, d / name)
    return {"ok": True, "name": name}


def list_backups(rel: str) -> dict:
    _safe_path(rel)
    d = ROOT / BACKUP_DIR / rel
    out = []
    if d.is_dir():
        for f in d.iterdir():
            if f.is_file() and BAK_NAME_RE.match(f.name):
                st = f.stat()
                out.append({"name": f.name, "mtime": int(st.st_mtime), "size": st.st_size})
    out.sort(key=lambda b: b["name"], reverse=True)
    return {"backups": out}


def restore_backup(rel: str, name: str) -> dict:
    p = _safe_path(rel)
    if not p.is_file():
        raise ApiError(404, "no such file")
    if not BAK_NAME_RE.match(name):
        raise ApiError(400, "bad backup name")
    src = ROOT / BACKUP_DIR / rel / name
    if not src.is_file():
        raise ApiError(404, "no such backup")
    with _write_lock:
        make_backup(rel, pre=True)
        fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", dir=str(p.parent))
        os.close(fd)
        try:
            shutil.copy2(src, tmp)
            shutil.copymode(p, tmp)
            os.replace(tmp, p)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
    _invalidate_cache(rel)
    return {"ok": True, "restored": name}


# ------------------------------------------------------------------ icons
#
# Item icons come straight out of the server's own mod jars, so modded items
# are accurate. Vanilla is absent on purpose: server jars ship no textures —
# the frontend falls back to a public asset CDN for the minecraft: namespace.

_icon_cache = {}   # server dir -> (mods mtime, {item id: (jar path, entry)})
_icon_lock = threading.Lock()

ITEM_ID_RE = re.compile(r"^[a-z0-9_.\-]+:[a-z0-9_/.\-]+$")
TEXTURE_RE = re.compile(r"^assets/([^/]+)/textures/(item|items|block|blocks|mob_effect)/(.+)\.png$")


def _icon_index(server_dir: Path) -> dict:
    mods = server_dir / "mods"
    key = str(server_dir)
    try:
        mtime = mods.stat().st_mtime
    except OSError:
        mtime = 0
    with _icon_lock:
        cached = _icon_cache.get(key)
        if cached and cached[0] == mtime:
            return cached[1]
    items, blocks, effects, base = {}, {}, {}, {}
    jars = sorted(mods.glob("*.jar")) if mods.is_dir() else []
    for jar in jars:
        try:
            with zipfile.ZipFile(jar) as z:
                for n in z.namelist():
                    m = TEXTURE_RE.match(n)
                    if not m:
                        continue
                    ns, kind, path = m.groups()
                    hit = (str(jar), n)
                    if kind == "mob_effect":
                        effects[f"{ns}:{path}"] = hit
                        continue
                    (items if kind.startswith("item") else blocks)[f"{ns}:{path}"] = hit
                    # mods often nest item textures in subdirs while the item
                    # id only carries the basename — keep a fallback key
                    base.setdefault(f"{ns}:{path.rsplit('/', 1)[-1]}", hit)
        except (OSError, zipfile.BadZipFile):
            continue
    index = {"item": items, "block": blocks, "effect": effects, "base": base}
    with _icon_lock:
        _icon_cache[key] = (mtime, index)
    return index


def _server_dir(server: str) -> Path:
    if not server or "/" in server or server.startswith("."):
        raise ApiError(400, "bad server name")
    sd = ROOT / server
    if not sd.is_dir():
        raise ApiError(404, "no such server")
    return sd


def read_icon(server: str, item_id: str, kind: str) -> bytes:
    sd = _server_dir(server)
    if not ITEM_ID_RE.match(item_id):
        raise ApiError(400, "bad item id")
    idx = _icon_index(sd)
    if kind == "effect":
        hit = idx["effect"].get(item_id)
    else:
        hit = idx["item"].get(item_id) or idx["block"].get(item_id) or idx["base"].get(item_id)
    if not hit:
        raise ApiError(404, "no icon")
    jar, entry = hit
    try:
        with zipfile.ZipFile(jar) as z:
            return z.read(entry)
    except (OSError, zipfile.BadZipFile, KeyError):
        raise ApiError(404, "icon unreadable")


def list_effects(server: str) -> dict:
    """Effect ids known to this server's mods (from mob_effect textures)."""
    return {"effects": sorted(_icon_index(_server_dir(server))["effect"].keys())}


def list_items(server: str) -> dict:
    """Item/block ids known to this server's mods (from item/block textures)."""
    idx = _icon_index(_server_dir(server))
    return {"items": sorted(set(idx["item"]) | set(idx["block"]))}


# ------------------------------------------------------------ server status

# We have no live ping, so "online" is inferred from logs/latest.log: a running
# server appends to it constantly (chunk saves, keepalive, player events), so a
# fresh mtime is a good proxy. Idle-but-up servers still tick often enough to
# stay inside this window; the same mtime doubles as "last active".
ONLINE_WINDOW = 300.0  # seconds


def _max_players(server_dir: Path):
    """max-players from server.properties, or None when absent/unreadable."""
    try:
        for line in (server_dir / "server.properties").read_text().splitlines():
            line = line.strip()
            if line.startswith("max-players"):
                return int(line.partition("=")[2].strip())
    except (OSError, ValueError):
        pass
    return None


def server_status() -> list:
    """Per-server landing status for every discovered server dir.

    Mirrors the server_dirs discovery in discover_tree(); player counts reuse
    the known-players list already computed for /api/tree (playerdata), not a
    live head-count we don't have.
    """
    try:
        server_dirs = sorted(d for d in ROOT.iterdir()
                             if d.is_dir() and not d.name.startswith("."))
    except OSError:
        server_dirs = []
    counts = {s["name"]: len(s.get("players", [])) for s in get_tree()["servers"]}
    now = time.time()
    out = []
    for sd in server_dirs:
        last_active = None
        online = False
        try:
            mtime = (sd / "logs" / "latest.log").stat().st_mtime
            last_active = int(mtime)
            online = (now - mtime) < ONLINE_WINDOW
        except OSError:
            pass
        out.append({
            "name": sd.name,
            "online": online,
            "players": counts.get(sd.name, 0),
            "maxPlayers": _max_players(sd),
            "lastActive": last_active,
        })
    return out


def read_server_icon(server: str) -> bytes:
    """The server's server-icon.png (MC standard 64x64), or 404 if absent."""
    sd = _server_dir(server)
    try:
        return (sd / "server-icon.png").read_bytes()
    except OSError:
        raise ApiError(404, "no icon")


# ------------------------------------------------------------------ server

MIME = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}


def _index_page() -> bytes:
    """The whole app + its initial data in ONE response.

    Inlines style.css and app.js and embeds the server tree as
    ``window.__NBT_TREE__``, so the first paint needs a single round trip
    instead of the serial /  -> css/js -> /api/tree chain. On a high-latency or
    jittery link (where every round trip risks a stall) that is the difference
    between instant and "loading forever". gzip still applies in _send.
    """
    css = (STATIC / "style.css").read_text()
    js = (STATIC / "app.js").read_text()
    html = (STATIC / "index.html").read_text()
    try:
        tree = json.dumps(get_tree())
    except Exception:
        tree = "null"
    # `<` only appears inside JSON string values, so escaping it can't corrupt
    # the data but does stop a stray </script> from closing the tag early.
    tree = tree.replace("<", "\\u003c")
    boot = f"<script>window.__NBT_TREE__={tree};</script>"
    html = html.replace('<link rel="stylesheet" href="/style.css">',
                        f"<style>{css}</style>")
    html = html.replace('<script src="/app.js"></script>',
                        f"{boot}<script>{js}</script>")
    return html.encode()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, body: bytes, ctype="application/json", cache="no-store",
              extra=None):
        # gzip when the client accepts it and there's enough body to be worth
        # it — the tree JSON and the JS/CSS are big and highly compressible, and
        # this link is slow.
        enc = None
        if (len(body) > 512 and not ctype.startswith("image/")
                and "gzip" in self.headers.get("Accept-Encoding", "")):
            body = gzip.compress(body, 6)
            enc = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if enc:
            self.send_header("Content-Encoding", enc)
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode())

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        url = urlparse(self.path)
        try:
            if url.path == "/api/tree":
                return self._json(200, get_tree())
            if url.path == "/api/servers/status":
                return self._json(200, server_status())
            if url.path == "/api/server-icon":
                q = parse_qs(url.query)
                png = read_server_icon(q.get("server", [""])[0])
                return self._send(200, png, "image/png", cache="max-age=300")
            if url.path == "/api/file":
                rel = parse_qs(url.query).get("path", [""])[0]
                return self._json(200, read_nbt(rel))
            if url.path == "/api/prefetch":
                # Parse + cache without shipping the (large) payload back —
                # used to warm files linked from a screen the client opened.
                rel = parse_qs(url.query).get("path", [""])[0]
                read_nbt(rel)
                return self._json(200, {"ok": True})
            if url.path == "/api/icon":
                q = parse_qs(url.query)
                png = read_icon(q.get("server", [""])[0], q.get("id", [""])[0],
                                q.get("kind", ["item"])[0])
                return self._send(200, png, "image/png", cache="max-age=86400")
            if url.path == "/api/effects":
                q = parse_qs(url.query)
                return self._json(200, list_effects(q.get("server", [""])[0]))
            if url.path == "/api/items":
                q = parse_qs(url.query)
                return self._json(200, list_items(q.get("server", [""])[0]))
            if url.path == "/api/backups":
                q = parse_qs(url.query)
                return self._json(200, list_backups(q.get("path", [""])[0]))
            if url.path in ("/", ""):
                return self._send(200, _index_page(), "text/html")
            return self._static(url.path)
        except ApiError as e:
            return self._json(e.status, {"error": str(e)})
        except Exception as e:
            return self._json(500, {"error": f"internal error: {e}"})

    def do_POST(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        try:
            if url.path == "/api/backup":
                return self._json(200, make_backup(q.get("path", [""])[0]))
            if url.path == "/api/restore":
                return self._json(200, restore_backup(q.get("path", [""])[0],
                                                      q.get("name", [""])[0]))
            raise ApiError(404, "unknown endpoint")
        except ApiError as e:
            return self._json(e.status, {"error": str(e)})
        except Exception as e:
            return self._json(500, {"error": f"internal error: {e}"})

    def do_PUT(self):
        url = urlparse(self.path)
        try:
            if url.path != "/api/file":
                raise ApiError(404, "unknown endpoint")
            rel = parse_qs(url.query).get("path", [""])[0]
            length = int(self.headers.get("Content-Length", "0"))
            if length > 256 * 1024 * 1024:
                raise ApiError(413, "payload too large")
            payload = json.loads(self.rfile.read(length))
            return self._json(200, write_nbt(rel, payload))
        except ApiError as e:
            return self._json(e.status, {"error": str(e)})
        except Exception as e:
            return self._json(500, {"error": f"internal error: {e}"})

    def _static(self, path: str):
        name = "index.html" if path in ("/", "") else path.lstrip("/")
        p = (STATIC / name).resolve()
        if STATIC.resolve() not in p.parents or not p.is_file():
            return self._json(404, {"error": "not found"})
        # Let the browser revalidate cheaply: an ETag from (mtime, size) means a
        # repeat load gets a tiny 304 instead of re-downloading ~90 KB of JS/CSS.
        st = p.stat()
        etag = f'"{int(st.st_mtime)}-{st.st_size}"'
        cache = "no-cache"   # cache, but revalidate every time (instant on 304)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            return
        self._send(200, p.read_bytes(), MIME.get(p.suffix, "application/octet-stream"),
                   cache=cache, extra=[("ETag", etag)])


def main():
    global ROOT
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True, help="parent directory containing server dirs")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8585)
    ap.add_argument("--tls-cert", help="PEM certificate file; serves HTTPS when given together with --tls-key")
    ap.add_argument("--tls-key", help="PEM private-key file (pairs with --tls-cert)")
    args = ap.parse_args()
    ROOT = Path(args.root)
    if not ROOT.is_dir():
        sys.exit(f"root directory does not exist: {ROOT}")
    if bool(args.tls_cert) != bool(args.tls_key):
        sys.exit("--tls-cert and --tls-key must be given together")
    with _tree_lock:
        _tree_cache["building"] = True
    threading.Thread(target=_prewarm, daemon=True).start()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    scheme = "http"
    if args.tls_cert:
        ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ctx.load_cert_chain(args.tls_cert, args.tls_key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        scheme = "https"
    print(f"nbt-web serving {ROOT} on {scheme}://{args.host}:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
