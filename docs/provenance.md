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
