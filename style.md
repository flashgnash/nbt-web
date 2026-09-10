# nbt-web UI style conventions

## Cards

Cards are always the full height of their row — every card in a row matches the
tallest card in that row (no ragged bottoms).

Implementation: grid and flex row containers must not set `align-items: start`.
The default (`stretch`) is correct; override only when there is a documented
reason.
