# nbt-web

Web-based NBT editor for a directory of minecraft servers. Point it at a
parent directory (e.g. `/srv/minecraft`) and it auto-discovers every server,
world (any dir containing `level.dat`, two levels deep), the players inside
them (`playerdata/*.dat`, labelled with names from each server's
`usercache.json`) and world `data/*.dat` files — all browsable as folders in
a sidebar with a fuzzy-find search.

The editor is a collapsible NBT tree: click a value to edit it inline
(validated against the tag type — byte/short/int/long ranges, longs handled
as BigInt so no precision loss), rename/delete compound keys, append list
and array elements, add new tags of any type. `Ctrl+S` saves.

Writes are safe-ish: the original file is copied to `<name>.nbtweb.bak`
(rolling, one per file) before an atomic temp-file + rename replace, and the
file's compression (gzip or plain), byte order and root name are preserved
exactly. Only `*.dat`, `*.dat_old` and `*.nbt` paths under the configured
root are ever readable or writable.

**No auth** — access control is the firewall: the NixOS module only opens the
port on the interfaces you list (default `tailscale0`), so only tailnet
peers can reach it.

Note: minecraft rewrites the playerdata of *online* players on save — edits
to a player who is currently connected will be overwritten. Edit offline
players, or stop the server for level.dat changes it holds in memory.

## Usage

```bash
nix run . -- --root /srv/minecraft --host 127.0.0.1 --port 8585
```

## NixOS

```nix
inputs.nbt-web.url = "github:flashgnash/nbt-web";

# in a host:
imports = [ inputs.nbt-web.nixosModules.default ];
services.nbt-web = {
  enable = true;
  parentDir = "/srv/minecraft";   # default
  port = 8585;                    # default
  user = "minecraft";             # default — needs rw on the server files
  exposeInterfaces = [ "tailscale0" ];  # default
};
```
