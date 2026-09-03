# Roadmap

DST.js grows through independently testable codecs and a shared domain model.
Existing public APIs remain stable unless a release explicitly documents a
breaking change.

## Phase 0: production baseline

- [x] KTEX decoding for DXT1, DXT3, DXT5, RGB, and RGBA.
- [x] Atlas XML parsing and UV-to-pixel conversion.
- [x] PNG extraction and manifest generation.
- [x] Loose-file and `images.zip` game resource access.
- [x] Simplified Chinese asset translation lookup.
- [x] Root and focused package exports.
- [x] Synthetic fixture tests, linting, type checking, and package build.

## Phase 1: animation decoding

- [x] Add bounded binary reader primitives with explicit endianness.
- [x] Decode `build.bin` into builds, symbols, frames, and atlas references.
- [x] Decode `anim.bin` into banks, animations, frames, and elements.
- [x] Preserve raw hashes and affine transforms without lossy decomposition.
- [x] Open animation ZIP files through a safe resource-source abstraction.
- [ ] Validate results against multiple independently implemented tools.

## Phase 2: animation composition

- [ ] Resolve build symbols and animation element references.
- [ ] Evaluate poses at a frame or timestamp.
- [ ] Support symbol overrides, hidden layers, and build swaps.
- [x] Render common rectangular poses and stable-size frame sequences to PNG.
- [ ] Render exact build triangle meshes and clipping masks.
- [ ] Establish documented coordinate, origin, and z-order conventions.

## Phase 3: conversion and encoding

- [ ] Export stable, versioned JSON.
- [ ] Encode KTEX and Atlas XML.
- [ ] Encode `build.bin` and `anim.bin` with round-trip tests.
- [ ] Evaluate SCML and Spine adapters without weakening the core model.
- [ ] Add an explicit compatibility report for lossy conversions.

## Public release gates

- [ ] Complete the provenance and dependency-license audit.
- [ ] Choose a compatible open-source license.
- [ ] Replace `UNLICENSED` and remove `private: true`.
- [ ] Add continuous integration across supported platforms.
- [ ] Verify `npm pack` contents contain no game assets.
- [ ] Publish API documentation and migration guarantees.
