# Driving environment attribution

## Track geometry

Horizontal centreline: OpenStreetMap ways [799394517 (Brünnchen)](https://www.openstreetmap.org/way/799394517), [799394518 (Eiskurve)](https://www.openstreetmap.org/way/799394518), and [799394519 (Pflanzgarten)](https://www.openstreetmap.org/way/799394519), downloaded from the public OSM API on 2026-09-19.

© OpenStreetMap contributors. The derived centreline database in [track-data.js](../../track-data.js) is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The module contains the transformed original control points and all generation code; no proprietary track assets are used. [OSM copyright and attribution](https://www.openstreetmap.org/copyright).

The 1,436 m horizontal route follows those OSM ways. Heights, camber, road width, kerbs, Armco, furniture and forest placement are authored approximations. This is a visual reconstruction of a section, not a laser scan or a surveyed replica. It is an open section, not a complete Nordschleife lap.

## Photographic materials — CC0

- **Asphalt 02** — Rob Tuytel / Poly Haven: https://polyhaven.com/a/asphalt_02 . Original 1K JPEG diffuse, OpenGL normal and roughness maps.
- **Forest Leaves 02** — Rob Tuytel / Poly Haven: https://polyhaven.com/a/forest_leaves_02 . Original 1K JPEG diffuse map, blended into the grass under the forest.
- **Bark Brown 02** — Poly Haven: https://polyhaven.com/a/bark_brown_02 . Original 1K JPEG diffuse map.
- **Leafy Grass** — Poly Haven: https://polyhaven.com/a/leafy_grass . Original 1K JPEG diffuse and OpenGL normal maps.

All Poly Haven assets are [CC0 1.0](https://polyhaven.com/license); the original downloads are served locally. Material colour, normal strength, metre-scale tiling and forest/grass blending were adjusted for the scene.

## Tree photographs — CC0

Dorian Zgraggen / **cgbookcase.com**:

- [Tree 01](https://www.cgbookcase.com/textures/tree-01) — `tree-01.webp`.
- [Tree 05](https://www.cgbookcase.com/textures/tree-05) — `maple-tree.webp`.
- [Tree 06](https://www.cgbookcase.com/textures/tree-06) — `tree-06.webp`.

The source pages identify these photographs as CC0 textures. Downloaded through the site's standard public download links. Runtime derivatives preserve the original aspect ratios and alpha, resize to 1,536 pixels tall, and encode as WebP (quality 88, alpha quality 100). No generative imagery or extracted game assets are used. The forest uses three crossed photographic planes per tree, with near-road trunk geometry and 760 crown-only photographic shrubs; these are photographic impostors rather than fully volumetric tree scans.

## Existing sky

The existing Kloppenheim 05 HDR environment remains separately attributed in `assets/environment/LICENSE.txt`.
