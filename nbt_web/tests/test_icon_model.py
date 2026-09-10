#!/usr/bin/env python3
"""Self-check for server.resolve_item_model against real mod jars.

No heavy test dependency — plain stdlib, prints PASS/FAIL and exits non-zero on
failure. Point it at a server directory with a populated ``mods/`` via env vars
(defaults to the ATM10 fixture):

    NBT_TEST_ROOT=/tmp NBT_TEST_SERVER=atm10-server \
        nix develop -c python3 nbt_web/tests/test_icon_model.py

If the fixture jars are absent the check SKIPs (exit 0) rather than failing, so
it is safe to run anywhere.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

ROOT = Path(os.environ.get("NBT_TEST_ROOT", "/tmp"))
SERVER = os.environ.get("NBT_TEST_SERVER", "atm10-server")

# (item id, expected kind, expected layer0 resource-location or None)
CASES = [
    # flat, parent item/generated -> layer0 sprite
    ("sophisticatedbackpacks:advanced_pickup_upgrade", "flat",
     "sophisticatedbackpacks:item/advanced_pickup_upgrade"),
    # custom loader model (a BER backpack) -> representative texture, no layer0
    ("sophisticatedbackpacks:backpack", "custom", None),
    # cube geometry model (elements) -> representative texture, no layer0
    ("ad_astra_giselle_addon:automation_nasa_workbench", "elements", None),
]


def main() -> int:
    server.ROOT = ROOT
    if not (ROOT / SERVER / "mods").is_dir():
        print(f"SKIP: no mods fixture at {ROOT / SERVER}/mods")
        return 0

    failures = 0
    for iid, want_kind, want_layer0 in CASES:
        doc = server.resolve_item_model(SERVER, iid)
        ok = doc["kind"] == want_kind
        if want_kind == "flat":
            ok = ok and doc["textures"].get("layer0") == want_layer0
            # the resolved sprite must actually be servable
            if ok:
                try:
                    png = server.read_texture(SERVER, doc["textures"]["layer0"])
                    ok = png[:4] == b"\x89PNG"
                except server.ApiError:
                    ok = False
        else:
            # non-flat: must expose a representative texture we can serve
            rep = doc.get("particle") or next(iter(doc["textures"].values()), None)
            ok = ok and bool(rep)
            if ok:
                try:
                    png = server.read_texture(SERVER, rep)
                    ok = png[:4] == b"\x89PNG"
                except server.ApiError:
                    ok = False
        status = "PASS" if ok else "FAIL"
        failures += not ok
        print(f"{status}: {iid} -> kind={doc['kind']} "
              f"textures={list(doc['textures'])} particle={doc.get('particle')}")

    # unknown item id must resolve to 'unresolved', not raise
    doc = server.resolve_item_model(SERVER, "no_such_mod:no_such_item")
    ok = doc["kind"] == "unresolved"
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'}: unknown id -> {doc['kind']}")

    print(f"\n{'ALL PASS' if not failures else str(failures) + ' FAILURE(S)'}")
    return 1 if failures else 0


import pytest

_SKIP_NO_FIXTURE = pytest.mark.skipif(
    not (ROOT / SERVER / "mods").is_dir(),
    reason=f"no mods fixture at {ROOT / SERVER}/mods",
)


def _setup():
    server.ROOT = ROOT


@_SKIP_NO_FIXTURE
def test_umbrella_separate_transforms_flat():
    """artifacts:umbrella — overrides-only + neoforge:separate_transforms → flat."""
    _setup()
    doc = server.resolve_item_model(SERVER, "artifacts:umbrella")
    assert doc["kind"] == "flat", f"expected flat, got {doc['kind']}"
    layer0 = doc["textures"].get("layer0")
    assert layer0 == "artifacts:item/umbrella_gui", f"unexpected layer0: {layer0}"
    png = server.read_texture(SERVER, layer0)
    assert png[:4] == b"\x89PNG", "layer0 texture is not a valid PNG"


@_SKIP_NO_FIXTURE
def test_promise_tier1_two_layers():
    """evilcraft:promise_tier_1 — two-layer flat model exposes layer0 + layer1."""
    _setup()
    doc = server.resolve_item_model(SERVER, "evilcraft:promise_tier_1")
    assert doc["kind"] == "flat", f"expected flat, got {doc['kind']}"
    assert "layer0" in doc["textures"], "missing layer0"
    assert "layer1" in doc["textures"], "missing layer1 (two-layer flat)"
    for k in ("layer0", "layer1"):
        png = server.read_texture(SERVER, doc["textures"][k])
        assert png[:4] == b"\x89PNG", f"{k} texture is not a valid PNG"


@_SKIP_NO_FIXTURE
def test_night_vision_goggles_texture_guess():
    """reliquified_artifacts:night_vision_goggles — no item model, but texture-guess
    fallback finds a PNG under abilities/night_vision_goggles/."""
    _setup()
    doc = server.resolve_item_model(SERVER, "reliquified_artifacts:night_vision_goggles")
    assert doc["kind"] == "unresolved", (
        f"expected unresolved (no model in jar), got {doc['kind']}"
    )
    # The icon endpoint must still serve something via the guess fallback.
    png = server.read_icon(SERVER, "reliquified_artifacts:night_vision_goggles", "")
    assert png[:4] == b"\x89PNG", "guess fallback did not return a valid PNG"


if __name__ == "__main__":
    sys.exit(main())
