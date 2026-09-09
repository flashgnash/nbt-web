#!/usr/bin/env python3
"""nbt-web — web-based NBT editor for a directory of minecraft servers.

Serves a small JSON API plus a static single-page frontend:

  GET /api/tree          discovered servers -> worlds -> players/data files
  GET /api/file?path=R   NBT file at R (relative to root) as tagged JSON
  PUT /api/file?path=R   write edited tagged JSON back (rolling .nbtweb.bak)

Only *.dat / *.dat_old / *.nbt files inside the root are ever touched.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import nbtlib
from nbtlib import tag as T

ROOT: Path = Path("/srv/minecraft")
STATIC: Path = Path(os.environ.get("NBT_WEB_STATIC", Path(__file__).parent / "static"))

NBT_EXTS = {".dat", ".dat_old", ".nbt"}

# Directories never worth descending into when hunting for worlds — huge
# and NBT-free (mod jars, logs, packwiz caches, plugin jars, ...).
PRUNE = {
    ".git", ".cache", "backups", "bundler", "cache", "config", "crash-reports",
    "defaultconfigs", "kubejs", "libraries", "logs", "mods", "node_modules",
    "packwiz", "plugins", "resourcepacks", "scripts", "shaderpacks", "versions",
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


def discover_tree() -> dict:
    servers = []
    try:
        server_dirs = sorted(d for d in ROOT.iterdir() if d.is_dir() and not d.name.startswith("."))
    except OSError:
        server_dirs = []
    for sd in server_dirs:
        names = _load_usercache(sd)
        worlds = []
        for wd in _find_worlds(sd):
            players = []
            pdir = wd / "playerdata"
            if pdir.is_dir():
                for f in sorted(pdir.glob("*.dat")):
                    uuid = f.stem
                    players.append({
                        "label": names.get(uuid.lower(), uuid),
                        "uuid": uuid,
                        "path": _rel(f),
                    })
            data = []
            ddir = wd / "data"
            if ddir.is_dir():
                data = [{"label": f.name, "path": _rel(f)} for f in sorted(ddir.glob("*.dat"))]
            worlds.append({
                "name": str(wd.relative_to(sd)),
                "level": _rel(wd / "level.dat"),
                "players": players,
                "data": data,
            })
        if worlds:
            servers.append({"name": sd.name, "worlds": worlds})
    return {"root": str(ROOT), "servers": servers}


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


def read_nbt(rel: str) -> dict:
    p = _safe_path(rel)
    if not p.is_file():
        raise ApiError(404, "no such file")
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
    return {"ok": True, "backup": p.name + ".nbtweb.bak"}


# ------------------------------------------------------------------ server

MIME = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
        ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, status, body: bytes, ctype="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj):
        self._send(status, json.dumps(obj).encode())

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        url = urlparse(self.path)
        try:
            if url.path == "/api/tree":
                return self._json(200, discover_tree())
            if url.path == "/api/file":
                rel = parse_qs(url.query).get("path", [""])[0]
                return self._json(200, read_nbt(rel))
            return self._static(url.path)
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
        self._send(200, p.read_bytes(), MIME.get(p.suffix, "application/octet-stream"))


def main():
    global ROOT
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True, help="parent directory containing server dirs")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8585)
    args = ap.parse_args()
    ROOT = Path(args.root)
    if not ROOT.is_dir():
        sys.exit(f"root directory does not exist: {ROOT}")
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"nbt-web serving {ROOT} on http://{args.host}:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
