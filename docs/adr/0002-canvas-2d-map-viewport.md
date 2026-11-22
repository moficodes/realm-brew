# Render the hex Map on an HTML5 Canvas 2D viewport

Although the UI shell is built with React and Tailwind CSS, the interactive hex Map is rendered with HTML5 Canvas 2D rather than DOM `<img>` or SVG elements. Canvas 2D keeps pan-and-zoom smooth across dozens of high-resolution (`1200×1039`) transparent-corner hex PNGs, enables exact axial-hex hit-testing without overlapping rectangular bounding boxes, and supports direct PNG export via canvas serialization.

## Considered Options

- **React DOM / SVG hex nodes**: Rejected because overlapping rectangular bounding boxes complicate hex hit-testing and dozens of large rotated raster PNGs degrade pan/zoom performance and complicate raster PNG export.
- **WebGL / PixiJS**: Rejected as unnecessary complexity for a 2D map planner of tens to low hundreds of tiles.
