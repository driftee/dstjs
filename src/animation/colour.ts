import sharp from "sharp";

export type AnimationColour = readonly [number, number, number, number];

export type AnimationColourTransform = {
  multiply?: AnimationColour;
  add?: AnimationColour;
};

const IDENTITY_MULTIPLY: AnimationColour = [1, 1, 1, 1];
const IDENTITY_ADD: AnimationColour = [0, 0, 0, 0];

export function parseAnimationColour(raw: string, option: string): AnimationColour {
  const components = raw.split(",").map((value) => value.trim());
  const values = components.map((value) => Number(value));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${option} 应为 4 个逗号分隔的数字：${raw}`);
  }
  if (components.some((value) => value.length === 0)) {
    throw new Error(`${option} 应为 4 个非空数字：${raw}`);
  }
  return values as unknown as AnimationColour;
}

export function hasAnimationColourTransform(
  transform: AnimationColourTransform,
): boolean {
  const multiply = transform.multiply ?? IDENTITY_MULTIPLY;
  const add = transform.add ?? IDENTITY_ADD;
  return multiply.some((value, index) => value !== IDENTITY_MULTIPLY[index])
    || add.some((value, index) => value !== IDENTITY_ADD[index]);
}

export function applyAnimationColourToRgba(
  source: Uint8Array,
  transform: AnimationColourTransform,
): Uint8Array {
  if (source.length % 4 !== 0) throw new Error("RGBA 数据长度必须是 4 的倍数");
  const multiply = transform.multiply ?? IDENTITY_MULTIPLY;
  const add = transform.add ?? IDENTITY_ADD;
  const output = Uint8Array.from(source);
  for (let offset = 0; offset < output.length; offset += 4) {
    const sourceAlpha = source[offset + 3] ?? 0;
    const outputAlpha = clampByte(sourceAlpha * (multiply[3] ?? 1));
    for (let channel = 0; channel < 3; channel += 1) {
      const premultiplied = Math.min(
        (source[offset + channel] ?? 0) * sourceAlpha / 255 * (multiply[channel] ?? 1)
          + sourceAlpha * (add[channel] ?? 0),
        outputAlpha,
      );
      output[offset + channel] = outputAlpha === 0
        ? 0
        : clampByte(premultiplied * 255 / outputAlpha);
    }
    output[offset + 3] = outputAlpha;
  }
  return output;
}

export async function applyAnimationColourToPng(
  source: Buffer,
  transform: AnimationColourTransform,
): Promise<Buffer> {
  if (!hasAnimationColourTransform(transform)) return source;
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return sharp(applyAnimationColourToRgba(data, transform), {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  }).png().toBuffer();
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
