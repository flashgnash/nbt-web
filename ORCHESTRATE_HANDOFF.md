# Hand-off: outstanding requests

Everything below was asked for this session. The **Delivered** list is on
`master` already; the **Outstanding** list is what's left for orchestrate.

## Delivered (on master)
- Boot cache of playerdata + `/api/prefetch` warming of linked files.
- Folia playerdata: discovery follows symlinked dirs + lists `world/playerdata` directly.
- Player view reorg: inventory then effects (left); position, spawn, experience, vitals, abilities (right).
- Effect amplifier/"potency" box always shows (materialised when 0).
- Add-effect modal: themed autocomplete, Enter takes highlighted first match, amp/duration side-by-side with labels above, duration clamped to 2^31-1, popup bodies on the light surface.
- Styled ID autocomplete (`comboBox`) with a first-match icon on **every** game-ID field (item, enchant, effect). `/api/items` lists mod item ids.
- Server-view files: drop `world/` prefix unless multiple dirs, flex-wrap. `balancedGrid()` for even tile rows (documented in nixos STYLE.md).
- Flat borderless UI: sidebar + top bar on the panel surface, `--border` transparent.
- Single-request boot: inline CSS/JS + embedded tree (~24 KB gzipped, one round trip). gzip + ETag on all responses.
- **Blanket storage engine**: `stackInfo`/`findStacks` detect any item OR fluid/chemical by shape (resource-location name + quantity), grouped by nearest named container — curios/baubles/trinkets, mekanism ender-chest frequencies, evilcraft shared tanks, backpacks, all with NO per-mod code. New "storage" view tab. Validated on live ATM10 / atm-attempt-2 data.
- HTTPS support in the server (`--tls-cert`/`--tls-key`) + NixOS module options (`tlsCertFile`/`tlsKeyFile`/`supplementaryGroups`).

## Outstanding — for orchestrate

1. **Deploy HTTPS.** The nbt-web code is on master, but the host wiring in
   `nixos-configuration/hosts/GLaDOS/default.nix` (tlsCertFile/tlsKeyFile =
   `/etc/ssl/tailscale-certs/*`, `supplementaryGroups = ["certs"]`, after
   `tailscale-autocert.service`) is **edited locally but uncommitted**. Commit
   it, then `nix flake update nbt-web` + `nixos-rebuild switch`. Reach it at the
   **MagicDNS FQDN** (`https://glados.<tailnet>.ts.net:8585`) so the cert name
   matches — bare `glados:8585` warns.

2. **Storage view: enable for player files too.** Currently the "storage" tab
   only shows for non-player files (players use the curated grid). A player with
   fluids/lone-stacks won't see them. Add the storage tab as a catch-all for
   playerdata as well (renderEditor `hasStorage` gate).

3. **Compound-map containers in the GRID browser.** The blanket storage view
   handles map-keyed containers, but the fancy slot-grid inventory browser
   (player view) still only renders list-style containers (ACC has `direct`/
   `wrapped`, no `map`). Add an `ACC.map` if a modded playerdata inventory turns
   out to be a slot→item compound rather than a list.

4. **Fluid icons + nicer fluid rows** in the storage view (fluids currently show
   no icon since the item-icon lookup misses them). Optional polish.

5. **Optional: merge per-slot curios into one panel.** Curios show as one small
   inventory per slot (head/ring/…) because that's how they're stored. User may
   prefer them grouped into a single "curios" panel.

6. **Tinkers Construct / Silent Gear "nice" editing** (the general-approach ask).
   Answer: those tools ARE normal item stacks, so they're already found + their
   id/count editable, and nested item stacks inside their components are found
   generically. What has no universal solution is their **internal material /
   modifier / stat data** — deeply nested, mod-invented NBT with no shared
   schema. Two general (non-hardcoded) routes:
   - **Data-driven schema registry** (recommended): ship optional JSON
     descriptors that map component keys (e.g. `silentgear:*`, `tconstruct:*`)
     to friendly field renderers. Mod knowledge lives in DATA, added once per
     mod, not in code. This is the only way to get nice mod-specific editors
     without per-mod methods.
   - **Generic name+value heuristic**: render any nested compound holding a
     resource-location string + a number as an editable "id = value" row (an
     extension of the stack heuristic to materials/traits/stats that lack a
     count). Catches a lot of Silent Gear material/trait data for free; imperfect
     but zero-config.
   - Until either lands, the **raw NBT view already edits all of it** — enough
     for the "fix broken data" use case.
