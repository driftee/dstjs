export type LottieStaticProperty<T> = {
  a: 0;
  k: T;
};

export type LottieHoldKeyframe<T> = {
  t: number;
  s: T;
  h: 1;
};

export type LottieLinearKeyframe<T> = {
  t: number;
  s: T;
  e?: T;
  i?: {
    x: number | number[];
    y: number | number[];
  };
  o?: {
    x: number | number[];
    y: number | number[];
  };
};

export type LottieAnimatedProperty<T> = {
  a: 1;
  k: Array<LottieHoldKeyframe<T> | LottieLinearKeyframe<T>>;
};

export type LottieScalarProperty =
  | LottieStaticProperty<number>
  | LottieAnimatedProperty<[number]>;

export type LottieVectorProperty =
  | LottieStaticProperty<[number, number, number]>
  | LottieAnimatedProperty<[number, number, number]>;

export type LottieImageAsset = {
  id: string;
  w: number;
  h: number;
  u: string;
  p: string;
  e: 0 | 1;
};

export type LottieImageLayer = {
  ddd: 0;
  ind: number;
  ty: 2;
  nm: string;
  refId: string;
  sr: 1;
  ks: {
    o: LottieStaticProperty<number>;
    r: LottieScalarProperty;
    p: LottieVectorProperty;
    a: LottieStaticProperty<[number, number, number]>;
    s: LottieVectorProperty;
    sk: LottieScalarProperty;
    sa: LottieStaticProperty<number>;
  };
  ao: 0;
  ip: number;
  op: number;
  st: 0;
  bm: 0;
};

export type LottieMarker = {
  tm: number;
  cm: string;
  dr: 0;
};

export type LottieAnimation = {
  v: string;
  fr: number;
  ip: 0;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: LottieImageAsset[];
  layers: LottieImageLayer[];
  markers?: LottieMarker[];
};

export type LottiePackage = {
  animation: LottieAnimation;
  images: ReadonlyMap<string, Buffer>;
};
