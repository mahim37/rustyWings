# Design

`mockups/` holds the throwaway HTML pages used to choose the UI direction on
2026-09-06. They share a fake simulation (`shared.js`) and chart engine; none
of it is production code.

| Page | Direction | Outcome |
|---|---|---|
| `a-observatory.html` | dark scientific dashboard | structure adopted |
| `b-console.html` | dashboard + command console and ⌘K palette | not adopted |
| `c-fieldguide.html` | light, illustrated birds, plain language | skin adopted |
| `d-hybrid.html` | **A's structure on C's skin** | **the reference for `web/`** |

`standalone/` contains the same pages with the shared script inlined, for
sending around. `shots/` are headless-Chrome renders at 1600×1000.

Palette: sparrows `#2a78d6`, hawks `#eb6834`, seeds `#1baf7a` on light
surfaces (dark: `#3987e5`, `#d95926`, `#199e70`). These are the first three
slots of a colourblind-validated categorical palette; text never wears a
series colour, identity comes from a mark beside it.
