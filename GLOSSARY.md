# Realm Brew Map Planner

A planning domain for laying out physical Realm Brew hexagonal dungeon tiles, tracking owned tile inventory across double-sided pieces, and previewing builds before tabletop assembly.

## Language

**Tileset**:
A themed pack of physical double-sided hexagonal tiles (for example, Man Hewn Dungeons or Underdark Caverns).
_Avoid_: Set, theme, pack, bundle

**Tile**:
A single physical double-sided hexagonal piece belonging to a Tileset, and the unit tracked in a Collection. Most Tiles carry two distinct faces (Side A and Side B); symmetric Tiles such as the solid dark tile carry the same artwork on both sides.
_Avoid_: Image, piece, card, hex

**Tile Face**:
One printed side of a Tile (Side A or Side B). Placing a Tile onto a Map displays one Tile Face and consumes the whole physical Tile, making both of its faces unavailable from that copy.
_Avoid_: Side, tile image, variant, sprite

**Map**:
A user-authored layout of placed Tiles arranged on a flat-top hexagonal grid representing a dungeon or encounter build.
_Avoid_: Board, canvas, scene, project

**Placement**:
A single instance of a Tile positioned at one hex position on a Map, with a chosen visible Tile Face and a 60-degree orientation step (one of six facings).
_Avoid_: Placed tile, cell, slot, instance

**Collection**:
The user's physical inventory of owned Tilesets, recorded as a copy count per Tileset. Availability against a Collection is evaluated independently for each Map rather than shared across saved Maps.
_Avoid_: Inventory, library, stock, catalog

**Overlay**:
A free-form visual prop or feature (such as a bridge, wall, trap, or furniture) layered on top of a Map independently of the hex grid.
_Avoid_: Prop, decal, sticker, token

**Pull List**:
A per-Tileset summary derived from a Map listing which physical Tiles and Tile Faces to pull from the user's Collection for tabletop assembly.
_Avoid_: Shopping list, packing list, BOM, build list
