# Realm Brew Map Planner

A planning domain for laying out physical Realm Brew hexagonal dungeon tiles and transparent overlays, tracking owned inventory across double-sided tiles and single-sided overlays, and previewing builds before tabletop assembly.

## Language

**Tileset**:
A themed box of physical double-sided hexagonal tiles (for example, Man Hewn Dungeons or Underdark Caverns).
_Avoid_: Set, theme, bundle

**Tile**:
A single physical double-sided hexagonal piece belonging to a Tileset, and the unit tracked in a Collection. Most Tiles carry two distinct faces (Side A and Side B); symmetric Tiles such as the solid dark tile carry the same artwork on both sides.
_Avoid_: Image, piece, card, hex

**Tile Face**:
One printed side of a Tile (Side A or Side B). Placing a Tile onto a Map displays one Tile Face and consumes the whole physical Tile, making both of its faces unavailable from that copy.
_Avoid_: Side, tile image, variant, sprite

**Overlay Pack**:
A themed pack of physical single-sided transparent Overlays (either accompanying a Tileset, such as Man Hewn Dungeons, or standalone, such as Alchemists' Workshop), tracked by copy count in a Collection.
_Avoid_: Overlay set, prop pack, bundle

**Overlay**:
A single physical single-sided transparent prop or feature piece (such as a bridge, wall, trap, or furniture) belonging to an Overlay Pack, and the unit tracked in a Collection.
_Avoid_: Prop, decal, sticker, token

**Map**:
A user-authored layout of placed Tiles and their attached Overlays arranged on a flat-top hexagonal grid representing a dungeon or encounter build.
_Avoid_: Board, canvas, scene, project

**Placement**:
A single instance of a Tile positioned at one hex position on a Map, with a chosen visible Tile Face and a 60-degree orientation step (one of six facings).
_Avoid_: Placed tile, cell, slot, instance

**Overlay Placement**:
A single instance of an Overlay attached to a host Placement, with a host-relative offset, continuous rotation angle, and stacking order.
_Avoid_: Attached overlay, placed prop, overlay instance

**Fog of War**:
A digital visibility state on a Placement—either covered or revealed—that hides its Tile and attached Overlay Placements behind dark Tile #37 artwork without consuming physical copies from a Collection.
_Avoid_: Shroud, mask, veil, blackout

**Collection**:
The user's physical inventory of owned Tilesets and Overlay Packs, recorded as an independent copy count per Tileset and per Overlay Pack. Availability against a Collection is evaluated independently for each Map rather than shared across saved Maps.
_Avoid_: Inventory, library, stock, catalog

**Pull List**:
A summary derived from a Map listing which physical Tiles, Tile Faces, and Overlays to pull from the user's Collection for tabletop assembly.
_Avoid_: Shopping list, packing list, BOM, build list
