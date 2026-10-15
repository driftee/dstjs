const ROOT_HELP = `DST.js - 解析、提取、转换和渲染《饥荒联机版》资源

用法：
  dst <命令> [操作] [参数]
  dst help [命令] [操作]
  dst <命令> [操作] --help

命令：
  anim      检查并导出 DST 动画
  atlas     从 Atlas XML 和 KTEX 中提取图片
  texture   解码 KTEX 纹理
  image     处理导出的图片
  game      从游戏目录批量提取资源
  names     解析原版或模组的正式名称
  cooking   导出料理资料
  turf      导出和诊断地皮资源

常用示例：
  dst anim inspect ./anim.zip
  dst anim frame ./anim.zip --animation idle --output ./idle.png
  dst anim gif ./anim.zip --animation idle_loop --output ./idle.gif
  dst anim web ./anim.zip --animation idle --output ./web-animation

运行 dst help <命令> 查看命令参数，例如 dst help anim。`;

const ANIM_HELP = `用法：
  dst anim <操作> <animation.zip> [参数]
  dst anim <操作> --anim <anim.zip> [--build <build.zip>] [参数]

操作：
  inspect   列出动画名称、bank、facing、帧率和帧数
  inspect-build 列出完整 build 部件、帧编号、尺寸和原点
  inspect-elements 导出 ANIM 原始帧、部件引用、图层与变换
  frame     导出指定动画的一帧 PNG
  frames    导出指定动画的全部 PNG 帧
  gif       导出指定动画的 GIF
  lottie    导出指定动画的 Lottie JSON
  web       导出 Wiki/浏览器可播放的 animation.json 和 atlas.webp

通用动画参数：
  --animation <名称>         选择动画；web 可重复使用此参数
  --build <build.zip>        使用独立 build 包
  --override-build <zip>     添加 symbol override build，可重复
  --override-build-symbol <zip>:<symbol> 仅从 override build 添加指定 symbol，可重复
  --bank <bank>              选择 bank
  --facing <编号>            选择 facing
  --override <原名=目标名>   替换 symbol，可重复
  --hide-layer <名称>        隐藏图层，可重复
  --hide-symbol <名称>       隐藏 symbol，可重复
  --skip-missing-symbols     忽略 build 中缺失的 symbol
  --crop-content             按非透明内容裁剪 frame 或 Web sprite
  --mult-colour <r,g,b,a>    模拟 AnimState:SetMultColour
  --add-colour <r,g,b,a>     模拟 AnimState:SetAddColour
  --scale <倍数>             设置 frame、frames、gif 的输出倍率
  --output <路径>            设置输出文件或目录

示例：
  dst anim inspect ./anim.zip
  dst anim frame ./anim.zip --animation idle --frame 0 --output ./idle.png
  dst anim gif --anim ./anim.zip --build ./build.zip --animation idle_loop --facing 8 --output ./idle.gif
  dst anim web ./anim.zip --animation idle --output ./representative

运行 dst anim <操作> --help 查看操作专属参数。`;

const ANIM_ACTION_HELP: Record<string, string> = {
  "inspect-elements": `用法：
  dst anim inspect-elements <anim.zip> [--animation <名称>] [--bank <bank>] [--facing <编号>]

导出筛选后的完整 ANIM 帧及 symbol/layer 名称与哈希、buildFrame、变换和 z。
不依赖 build；保留未解析名称的哈希，不隐藏缺失部件。`,
  "inspect-build": `用法：
  dst anim inspect-build <build.zip>

输出完整 BILD 的 symbol、frameNumber、duration、局部 bounds、原点和图集索引。
不需要 anim.bin；不是单个动画使用的部件子集。方向须与 ANIM 引用交叉核实。`,
  inspect: `用法：
  dst anim inspect <animation.zip>
  dst anim inspect --anim <anim.zip>

输出 JSON，包含每段动画的 name、bank、facing、frameRate、frames 和 duration。

示例：
  dst anim inspect ./anim.zip`,
  frame: `用法：
  dst anim frame <animation.zip> --animation <名称> [参数]

参数：
  --anim <anim.zip>          使用拆分的动画包
  --build <build.zip>        使用独立 build 包
  --override-build <zip>     添加 symbol override build，可重复
  --override-build-symbol <zip>:<symbol> 仅从 override build 添加指定 symbol，可重复
  --bank <bank>              选择 bank
  --facing <编号>            选择 facing
  --frame <序号>             帧序号，默认 0
  --scale <倍数>             输出倍率，默认 1
  --override <原名=目标名>   替换 symbol，可重复
  --hide-layer <名称>        隐藏图层，可重复
  --hide-symbol <名称>       隐藏 symbol，可重复
  --skip-missing-symbols     忽略缺失 symbol
  --crop-content             按非透明内容裁剪最终 PNG
  --alpha-threshold <0-255>  裁剪透明阈值，默认 0
  --padding <像素>           裁剪后保留的透明边距，默认 0
  --render-padding <像素>    渲染前扩展画布边距，默认 2，最大 1024
  --mult-colour <r,g,b,a>    模拟 AnimState:SetMultColour
  --add-colour <r,g,b,a>     模拟 AnimState:SetAddColour
  --output <PNG>             输出路径

示例：
  dst anim frame ./anim.zip --animation idle --frame 0 --output ./idle.png`,
  frames: `用法：
  dst anim frames <animation.zip> --animation <名称> [参数]

参数与 frame 基本相同；--output 指定帧序列目录，不接受 --frame。

示例：
  dst anim frames ./anim.zip --animation idle_loop --output ./idle-frames`,
  gif: `用法：
  dst anim gif <animation.zip> --animation <名称> [参数]

支持 --anim、--build、--override-build、--bank、--facing、--scale、
--override、--hide-layer、--hide-symbol、--skip-missing-symbols、--mult-colour、
--add-colour 和 --output。
GIF 不支持半透明 alpha；--mult-colour 的第 4 项必须为 1。

示例：
  dst anim gif --anim ./anim.zip --build ./build.zip --animation idle_loop --facing 8 --output ./idle.gif`,
  lottie: `用法：
  dst anim lottie <animation.zip> --animation <名称> [参数]

专属参数：
  --padding <像素>
  --external-images
  --keyframe-mode <lossless|linear|visual|0|1|2>
  --keyframe-tolerance <像素>

同时支持动画通用的 build、bank、facing、override、颜色和输出参数。

示例：
  dst anim lottie ./anim.zip --animation idle_loop --output ./idle.lottie.json`,
  web: `用法：
  dst anim web <animation.zip> [--animation <名称>]... [参数]

输出 animation.json 与 atlas.webp。

专属参数：
  --demo                     同时生成场景演示
  --player                   同时生成动画播放器
  --title <标题>             设置播放器标题
  --scene <JSON>             为播放器添加独立 follower 实体
  --variant <名称:原名=目标名>
  --crop-content             裁剪各 sprite 并补偿原点
  --alpha-threshold <0-255>  裁剪透明阈值，默认 0
  --padding <像素>           sprite 裁剪后保留的透明边距，默认 0

同时支持动画通用的 build、bank、facing、override、隐藏图层、颜色和输出参数。

示例：
  dst anim web ./anim.zip --animation idle --output ./representative
  dst anim web ./anim.zip --animation idle --player --scene ./scene.json --output ./preview`,
};

const COMMAND_HELP: Record<string, string> = {
  atlas: `用法：
  dst atlas <atlas.xml> [--tex <texture.tex>] [--output <目录>]

从 Atlas XML 与对应 KTEX 中提取透明 PNG 图片。`,
  game: `用法：
  dst game <游戏目录或 data 目录> [--match <名称>]... [--output <目录>]

从本地游戏资源中批量提取名称匹配的 Atlas。`,
  names: `用法：
  dst names resolve <游戏目录或 data 目录> <prefab>...
  dst names resolve-mod <模组目录> <prefab>...

resolve 从原版 chinese_s.po 解析正式中文名，命中时置信度为 EXACT。
resolve-mod 静态扫描模组 Lua 中的 STRINGS.NAMES 字面量赋值：
- 中文候选唯一时返回 STATIC，仍需结合语言分支复核。
- 多个不同中文候选时返回 AMBIGUOUS。
- 无中文候选时返回 UNMATCHED。

两种操作都输出 JSON，不会根据 prefab 自行翻译。

示例：
  dst names resolve "/path/to/Don't Starve Together" lunarplant_husk
  dst names resolve-mod ./workshop-1234567890 ce_drill_notes`,
  texture: `用法：
  dst texture decode <texture.tex> [--output <PNG 或目录>]

将 KTEX 纹理解码为 PNG。`,
  image: `用法：
  dst image prune <image.png|image.gif> [参数]

参数：
  --padding <像素>
  --padding-top <像素>
  --padding-right <像素>
  --padding-bottom <像素>
  --padding-left <像素>
  --alpha-threshold <0-255>
  --output <PNG/GIF 或目录>`,
  cooking: `用法：
  dst cooking catalog <游戏目录或 data 目录> [--output <目录>]

导出食材、料理配方和可用图标。`,
  turf: `用法：
  dst turf <操作> [输入] [--output <路径>]

操作：
  calibration-assets  生成地皮校准 Mod 资源
  ocean-assets        导出海洋纹理和波浪资源
  parse-log           解析校准日志
  capture             从客户端日志采集截图
  coast-capture       采集海岸截图
  recognize           识别地皮截图
  recognize-native    生成原生 256 项查表
  derive-mapping      从识别结果推导映射
  simulator           生成地皮模拟器
  catalog             导出原版地皮目录
  mod-catalog         导出模组地皮目录`,
};

const HELP_ALIASES: Record<string, string> = {
  animation: "anim",
  "-h": "",
  "--help": "",
};

export function resolveHelpTopic(arguments_: string[]): string[] | null {
  if (arguments_.length === 0) return [];
  const [command, ...rest] = arguments_;
  if (command === "help") return rest.filter((value) => !value.startsWith("-"));
  const helpIndex = arguments_.findIndex((value) => value === "--help" || value === "-h");
  if (helpIndex === -1) return null;
  return arguments_.slice(0, helpIndex).filter((value) => !value.startsWith("-"));
}

export function formatCliHelp(topic: string[]): string {
  const normalized = topic.map((part) => HELP_ALIASES[part] ?? part);
  const [command, action] = normalized;
  if (!command) return ROOT_HELP;
  if (command === "anim") {
    if (!action) return ANIM_HELP;
    const actionHelp = ANIM_ACTION_HELP[action];
    if (actionHelp) return actionHelp;
  } else if (!action) {
    const commandHelp = COMMAND_HELP[command];
    if (commandHelp) return commandHelp;
  }
  return `未知帮助主题：${topic.join(" ")}\n\n${ROOT_HELP}`;
}
