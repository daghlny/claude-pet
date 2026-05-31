# claude-pet

[English](README.md) · **简体中文**

一个为 [Claude Code](https://claude.com/claude-code) 打造的桌面宠物。它住在你的
桌面上，会对你的 Claude Code 会话状态做出反应——工作中、等待中、已完成、出错——
并且点一下就能跳回它所属的那个终端会话。

兼容 petdex / codex-pets 的素材格式：把任意 `pet.json` +
`spritesheet.{png,webp}` 包放进 `~/.claude-pet/pets/<slug>/`，它就会出现在选择器里。

v0.1 仅支持 macOS。跨平台的基础已经铺好
（`focusTerminal.ts` 和 hook 脚本是仅有的 macOS 专属部分）。

## 安装

一键安装：

```bash
./install.sh        # 安装依赖 + 生成内置宠物 + 编译 + 接入 hooks
npm start           # 启动 Electron 应用
```

`./install.sh --no-hooks` 会编译全部内容，但不改动
`~/.claude/settings.json`。等价的手动步骤：

```bash
npm install
npm run gen:builtins       # 生成 2 个内置宠物的精灵图
npm run build              # 编译 TS + 拷贝 renderer HTML
node dist/cli/index.js install   # 把 hooks 写入 ~/.claude/settings.json
npm start                  # 启动 Electron 应用
```

然后在 Terminal / iTerm 里启动任意 `claude` 会话——宠物就会在权限提示、
工具运行、任务完成和出错时做出对应动画。

## CLI

```bash
claude-pet install     # 向 ~/.claude/settings.json 添加 hook 条目
claude-pet status      # 查看安装状态 + 事件日志路径
claude-pet uninstall   # 移除 hook 条目
claude-pet import <src># 导入一个宠物包（文件夹 | .zip | http(s) 的 .zip URL）
```

（如果你还没有链接 `claude-pet` 这个命令，请用
`node dist/cli/index.js <命令>` 的形式调用。）

`claude-pet install` 是幂等的——重复运行只会替换之前由 claude-pet 写入的
hook 条目，其余设置保持不变（会在 `settings.json` 旁边写一份
`.claude-pet.bak` 备份）。

## 工作原理

1. CLI 会为以下 Claude Code 事件注册 `hooks/claude-pet-emit.sh`：
   `SessionStart`、`PreToolUse`、`PostToolUse`、`Stop`、
   `StopFailure`、`Notification`、`SessionEnd`。
2. 每次事件触发时，脚本会沿父进程树向上查找，记录终端应用 +
   控制 tty，然后向 `~/.claude-pet/events.jsonl` 追加一行 JSON。
3. Electron 主进程用 `chokidar` 跟踪（tail）该文件，并把每个事件映射到
   一个宠物动画状态 + 气泡文字：

   | 事件                                  | 状态     | 气泡                      |
   |--------------------------------------|----------|--------------------------|
   | `SessionStart`                       | `jump`   | “Claude is ready.”       |
   | `PreToolUse`                         | `run`    | “Running &lt;tool&gt;…”        |
   | `Notification`（permission\_prompt） | `review` | “Needs your permission.” |
   | `Notification`（idle\_prompt）       | `wave`   | “Waiting on you.”        |
   | `Stop`                               | `wave`   | “Done — your turn.”      |
   | `StopFailure`                        | `failed` | error\_type              |
   | `SessionEnd`                         | `idle`   | “Session ended.”         |

4. 点击宠物 → 一段 AppleScript 会在 Terminal.app 或 iTerm2 中查找记录下来的
   tty，并把那个具体的标签页提到最前。若失败则退而求其次激活终端应用，
   再不行则在 Finder 中打开 `cwd`。

## 宠物包格式（兼容 petdex）

```
my-pet/
├── pet.json
└── spritesheet.png      # 或 .webp
```

`spritesheet.png`：8 行 × 9 列，每帧 **192×208**
（总计 **1728×1664**）。行顺序：

```
0 idle    1 wave   2 run    3 failed
4 review  5 jump   6 extra1 7 extra2
```

`pet.json`：

```json
{
  "name": "Blob",
  "slug": "blob",
  "tags": ["builtin"],
  "kind": "builtin",
  "spritesheet": "spritesheet.png",
  "frame":   { "w": 192, "h": 208 },
  "grid":    { "cols": 9, "rows": 8 },
  "frames":    { "idle": 6, "run": 6 },
  "durations": { "idle": 1100, "run": 800 }
}
```

`frames` / `durations` 是可选的（默认：每状态 6 帧，循环 1100 毫秒）。

把你的宠物文件夹放进 `~/.claude-pet/pets/<slug>/`，或在应用内使用
**Settings → Import pet folder…**。由 petdex 分发的宠物（`npx petdex
install <slug>`）也遵循同样的约定。

### 通过 CLI 导入宠物包

```bash
claude-pet import ./my-pet                       # 本地文件夹
claude-pet import ./my-pet.zip                    # 本地 zip
claude-pet import https://example.com/my-pet.zip  # 远程 zip
```

即使 zip 把宠物包套在了一层顶层文件夹里，导入器也能定位到 `pet.json`，
校验后把它拷贝进 `~/.claude-pet/pets/<slug>/`。codex-pets 的清单字段
（`id` / `displayName` / `spritesheetPath`）会被自动接受并归一化。

> zip / URL 导入会调用系统的 `unzip` 和 `curl`（macOS 和大多数 Linux 发行版
> 都自带）。

### 使用来自 codex-pets.net 的宠物

[codex-pets.net](https://codex-pets.net/) 上有一个社区宠物包的画廊，它们使用
相同的精灵图格式。浏览该网站，挑一个你喜欢的宠物，记下它的 **slug**
（即其页面 URL 的最后一段路径，例如 `deepseek`）。

**最简单——直接从网站导入到 Claude Pet：**

```bash
claude-pet import "https://codex-pets.net/api/pets/<slug>/download"
# 例如
claude-pet import "https://codex-pets.net/api/pets/deepseek/download"
```

这一条命令就会下载宠物包并安装到 `~/.claude-pet/pets/<slug>/`。重启
Claude Pet（或直接重新启动），然后从托盘菜单里选中它即可。

**已经用 codex 自带的工具装过了？** codex-pets 会安装到
`~/.codex/pets/<slug>/`。把导入器指向那个文件夹，即可拷贝进 Claude Pet：

```bash
# 在执行过 `npx codex-pets add deepseek` 之后
claude-pet import ~/.codex/pets/deepseek
```

> Claude Pet 从 `~/.claude-pet/pets/` 读取，而 codex 从 `~/.codex/pets/`
> 读取。两者互相独立——`import` 负责把宠物包从 codex 的位置（或直接从网站）
> 搭桥导入到 Claude Pet。

## 扩展到 macOS 之外

macOS 专属的代码被隔离在：

- `hooks/claude-pet-emit.sh` —— 使用 `ps` 遍历进程树。
  Linux 可直接使用；Windows 需要一个 `.ps1` 等价实现。
- `src/main/focusTerminal.ts` —— AppleScript。请替换为 `wmctrl`
  （Linux）或 `powershell` 的窗口激活（Windows），并根据
  `process.platform` 分派。

事件日志、宠物加载器、状态映射器和 renderer 都是平台无关的。

## 许可证

MIT
