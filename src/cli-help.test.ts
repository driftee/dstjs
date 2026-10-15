import { describe, expect, it } from "vitest";

import { formatCliHelp, resolveHelpTopic } from "./cli-help.js";

describe("resolveHelpTopic", () => {
  it.each([
    [[], []],
    [["help"], []],
    [["--help"], []],
    [["-h"], []],
    [["help", "anim"], ["anim"]],
    [["anim", "--help"], ["anim"]],
    [["anim", "frame", "-h"], ["anim", "frame"]],
  ])("resolves %j to %j", (input, expected) => {
    expect(resolveHelpTopic(input)).toEqual(expected);
  });

  it("does not intercept a normal command", () => {
    expect(resolveHelpTopic(["anim", "inspect", "./anim.zip"])).toBeNull();
  });
});

describe("formatCliHelp", () => {
  it("shows command discovery and common animation examples at the root", () => {
    const help = formatCliHelp([]);
    expect(help).toContain("dst help [命令] [操作]");
    expect(help).toContain("dst anim inspect ./anim.zip");
  });

  it("shows action-specific animation options", () => {
    const help = formatCliHelp(["anim", "frame"]);
    expect(help).toContain("dst anim frame <animation.zip>");
    expect(help).toContain("--skip-missing-symbols");
    expect(help).toContain("--crop-content");
    expect(help).toContain("--mult-colour <r,g,b,a>");
    expect(help).toContain("--add-colour <r,g,b,a>");
  });

  it("documents content cropping for Web animation exports", () => {
    const help = formatCliHelp(["anim", "web"]);
    expect(help).toContain("--crop-content");
    expect(help).toContain("--alpha-threshold <0-255>");
    expect(help).toContain("--scene <JSON>");
    expect(help).toContain("--player --scene ./scene.json");
  });

  it("documents authoritative base and static mod name resolution", () => {
    const help = formatCliHelp(["names"]);
    expect(help).toContain("dst names resolve <游戏目录或 data 目录> <prefab>...");
    expect(help).toContain("dst names resolve-mod <模组目录> <prefab>...");
    expect(help).toContain("EXACT");
    expect(help).toContain("STATIC");
    expect(help).toContain("AMBIGUOUS");
    expect(help).toContain("不会根据 prefab 自行翻译");
  });
});
