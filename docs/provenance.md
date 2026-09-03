# Implementation provenance

This document records the origin of DST.js code and is a required public
release checklist.

## Initial baseline

The initial texture, atlas, game-source, translation, and extraction modules
were migrated from the private `@qineko/ktools-node` package in the QiNeko Wiki
workspace. That package has already been exercised by the QiNeko Wiki API and
Electron desktop application.

No game images, textures, animation archives, or other Klei assets are included
in DST.js. Automated tests use synthetic inputs created by the test suite.

The first ANIM/BILD decoder implementation was independently written in
TypeScript on 2026-08-25. During implementation, the following existing tools
were consulted to understand and validate the binary layout:

- `Akarinnnnn/KleiAnim`, MIT licensed. Its attribution and license are retained
  in `NOTICE.md` and `third_party/KleiAnim-LICENSE`.
- The local GPL-licensed `ktools` checkout was reviewed as a behavioral and
  format reference. No C++ source file was copied into DST.js. The public
  release audit must still compare structure and expression carefully before
  selecting a DST.js license.

Real `wet_meter.zip` and `firefighter_projectile.zip` files from the developer's
local game installation were used only for local validation. Generated PNG and
GIF files remain under the ignored `output/` directory and are not committed.

## Public release blockers

- Review the history and authorship of every migrated source file.
- Compare migrated code with the GPL-2.0 `ktools` project and identify any code
  that was copied, translated, or structurally derived from it.
- Confirm attribution and notice requirements for every third-party source.
- Choose a project license compatible with the audit result.
- Run a dependency-license report and update `NOTICE.md`.
- Verify that Git history, fixtures, release archives, and npm package contents
  contain no Klei game assets.
- Keep `.dyn` decryption and entitlement-bypass functionality out of scope
  unless Klei grants explicit permission.

Until these items are complete, `package.json` must remain private and use the
`UNLICENSED` marker.
