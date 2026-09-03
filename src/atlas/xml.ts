import path from "node:path";

import { XMLParser } from "fast-xml-parser";

export type AtlasElement = {
  name: string;
  u1: number;
  u2: number;
  v1: number;
  v2: number;
};

export type AtlasSheet = {
  texture: string;
  elements: AtlasElement[];
};

type OrderedNode = {
  Atlas?: OrderedNode[];
  Texture?: OrderedNode[];
  Elements?: OrderedNode[];
  Element?: OrderedNode[];
  ":@"?: Record<string, string>;
};

const parser = new XMLParser({
  allowBooleanAttributes: false,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  preserveOrder: true,
  processEntities: false,
});

export function parseAtlasXml(xml: string): AtlasSheet[] {
  const document = parser.parse(xml) as OrderedNode[];
  const atlas = document.find((node) => node.Atlas)?.Atlas;
  if (!atlas) throw new Error("XML 缺少 Atlas 根节点");

  const sheets: AtlasSheet[] = [];
  for (let index = 0; index < atlas.length; index += 1) {
    const textureNode = atlas[index];
    if (!textureNode?.Texture) continue;
    const texture = requiredAttribute(textureNode, "filename");
    const elementsNode = atlas[index + 1];
    if (!elementsNode?.Elements) throw new Error(`Texture ${texture} 后缺少 Elements 节点`);
    const elements = elementsNode.Elements
      .filter((node) => node.Element)
      .map((node) => ({
        name: requiredAttribute(node, "name"),
        u1: numberAttribute(node, "u1"),
        u2: numberAttribute(node, "u2"),
        v1: numberAttribute(node, "v1"),
        v2: numberAttribute(node, "v2"),
      }));
    sheets.push({ texture, elements });
    index += 1;
  }

  if (sheets.length === 0) throw new Error("Atlas XML 不包含 Texture 节点");
  return sheets;
}

export function uvToRectangle(
  element: AtlasElement,
  textureWidth: number,
  textureHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.floor(element.u1 * textureWidth);
  const top = Math.floor((1 - element.v2) * textureHeight);
  const right = Math.ceil(element.u2 * textureWidth);
  const bottom = Math.ceil((1 - element.v1) * textureHeight);

  if (
    left < 0
    || top < 0
    || right > textureWidth
    || bottom > textureHeight
    || right <= left
    || bottom <= top
  ) {
    throw new Error(`Atlas 元素 ${element.name} 的 UV 坐标越界`);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function safeImageName(elementName: string): string {
  const withoutExtension = elementName.replace(/\.[^.]+$/, "");
  const safe = withoutExtension
    .normalize("NFKC")
    .replaceAll("\\", "__")
    .replaceAll("/", "__")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!safe) throw new Error(`Atlas 元素名称无效：${elementName}`);
  return `${safe}.png`;
}

export function resolveTextureKey(atlasKey: string, texture: string): string {
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(atlasKey), texture));
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Atlas 引用了不安全的纹理路径：${texture}`);
  }
  return normalized;
}

function requiredAttribute(node: OrderedNode, name: string): string {
  const value = node[":@"]?.[name];
  if (!value) throw new Error(`XML 属性 ${name} 缺失`);
  return value;
}

function numberAttribute(node: OrderedNode, name: string): number {
  const raw = requiredAttribute(node, name);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`XML 属性 ${name} 不是有效数字`);
  return value;
}
