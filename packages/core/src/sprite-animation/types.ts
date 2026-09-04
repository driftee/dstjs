export type SpriteAnimationMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
];

export type SpriteAnimationTransformChannels = {
  readonly position: readonly [x: number, y: number];
  readonly rotation: number;
  readonly scale: readonly [x: number, y: number];
  readonly skewX: number;
};

export type SpriteAnimationTransform = {
  readonly matrix: SpriteAnimationMatrix;
  readonly channels: SpriteAnimationTransformChannels;
};

export type SpriteAnimationRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SpriteAnimationAsset = {
  id: string;
  name: string | null;
  width: number;
  height: number;
  originX: number;
  originY: number;
  mimeType: "image/png";
  metadata?: Readonly<Record<string, unknown>>;
};

export type SpriteAnimationEvent = {
  name: string | null;
  metadata?: Readonly<Record<string, unknown>>;
};

export type SpriteAnimationElement = {
  spriteId: string;
  layerId: string;
  layerName: string | null;
  transform: SpriteAnimationTransform;
  z: number;
  metadata?: Readonly<Record<string, unknown>>;
};

export type SpriteAnimationFrame = {
  bounds: SpriteAnimationRectangle;
  events: SpriteAnimationEvent[];
  elements: SpriteAnimationElement[];
};

export type SpriteAnimationClip = {
  id: string;
  name: string;
  frameRate: number;
  durationFrames: number;
  frames: SpriteAnimationFrame[];
  metadata?: Readonly<Record<string, unknown>>;
};

export type SpriteAnimationDocument = {
  format: "dstjs-sprite-animation";
  version: 1;
  coordinateSystem: {
    xAxis: "right";
    yAxis: "down";
    transform: "affine-2d";
  };
  assets: Record<string, SpriteAnimationAsset>;
  clips: SpriteAnimationClip[];
  metadata?: Readonly<Record<string, unknown>>;
};

export type SpriteAnimationPackage = {
  document: SpriteAnimationDocument;
  images: ReadonlyMap<string, Uint8Array>;
};
