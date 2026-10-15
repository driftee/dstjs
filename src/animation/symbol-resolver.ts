import type { DecodedKtex } from "../texture/ktex.js";
import type { BuildBundle } from "./archive.js";
import type { BuildSymbol } from "./types.js";

export type BuildSymbolSource = {
  symbol: BuildSymbol;
  atlases: readonly DecodedKtex[];
};

export type BuildSymbolResolver = {
  resolveHash: (hash: number) => BuildSymbolSource | undefined;
  resolveName: (name: string) => BuildSymbolSource | undefined;
};

export function createBuildSymbolResolver(
  baseBuild: BuildBundle,
  overrideBuilds: readonly BuildBundle[] = [],
): BuildSymbolResolver {
  const sourcesByHash = new Map<number, BuildSymbolSource>();
  const sourcesByName = new Map<string, BuildSymbolSource>();

  for (const build of [baseBuild, ...overrideBuilds]) {
    const atlases = build.build.atlases.map((name) => {
      const atlas = build.atlases.get(name);
      if (!atlas) throw new Error(`找不到 atlas ${name}`);
      return atlas;
    });
    for (const symbol of build.build.symbols) {
      const source = { symbol, atlases };
      sourcesByHash.set(symbol.hash, source);
      if (symbol.name) sourcesByName.set(symbol.name, source);
    }
  }

  return {
    resolveHash: (hash) => sourcesByHash.get(hash),
    resolveName: (name) => sourcesByName.get(name),
  };
}
