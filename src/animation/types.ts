export type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AffineTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

export type AnimationElement = {
  symbolHash: number;
  symbolName: string | null;
  buildFrame: number;
  layerHash: number;
  layerName: string | null;
  transform: AffineTransform;
  z: number;
};

export type AnimationEvent = {
  hash: number;
  name: string | null;
};

export type AnimationFrame = {
  bounds: Rectangle;
  events: AnimationEvent[];
  elements: AnimationElement[];
};

export type Animation = {
  name: string;
  facing: number;
  bankHash: number;
  bankName: string | null;
  frameRate: number;
  frames: AnimationFrame[];
};

export type AnimationFile = {
  version: number;
  animations: Animation[];
  hashTable: ReadonlyMap<number, string>;
};

export type BuildVertex = {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  w: number;
};

export type BuildFrame = {
  frameNumber: number;
  duration: number;
  bounds: Rectangle;
  alphaIndex: number;
  alphaCount: number;
  vertices: BuildVertex[];
};

export type BuildSymbol = {
  hash: number;
  name: string | null;
  frames: BuildFrame[];
};

export type BuildFile = {
  version: number;
  name: string;
  atlases: string[];
  symbols: BuildSymbol[];
  vertices: BuildVertex[];
  hashTable: ReadonlyMap<number, string>;
};
