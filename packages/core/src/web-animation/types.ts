export type WebAnimationTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
];

export type WebAnimationSprite = {
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
};

export type WebAnimationElement = {
  sprite: string;
  transform: WebAnimationTransform;
  z: number;
  layerName?: string;
  symbolName?: string;
  buildFrame?: number;
};

export type WebAnimationFrame = {
  elements: WebAnimationElement[];
};

export type WebAnimationClip = {
  frameRate: number;
  duration: number;
  frames: WebAnimationFrame[];
};

export type WebAnimationEntityFollow = {
  layerName?: string;
  symbolName?: string;
  buildFrame?: number;
  occurrence?: number;
  x?: number;
  y?: number;
  scale?: number;
};

export type WebAnimationSceneEntity = {
  id: string;
  animation: string;
  follow: WebAnimationEntityFollow;
  zOffset?: number;
  timeOffset?: number;
};

export type WebAnimationScene = {
  rootAnimation: string;
  entities: WebAnimationSceneEntity[];
};

export type WebAnimationManifest = {
  format: "dstjs-web-animation";
  version: 1;
  atlas: {
    file: string;
    width: number;
    height: number;
  };
  sprites: Record<string, WebAnimationSprite>;
  animations: Record<string, WebAnimationClip>;
  scene?: WebAnimationScene;
};

export type WebAnimationPackage = {
  manifest: WebAnimationManifest;
  atlas: Uint8Array;
};
