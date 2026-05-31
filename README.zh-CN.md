# claude-pet

[English](README.md) · **简体中文**

一个为 [Claude Code](https://claude.com/claude-code) 打造的桌面宠物。它住在你的
桌面上，会对 Claude Code 会话状态做出反应——工作中、等待中、已完成、出错——
点一下还能跳回它所属的那个终端会话。

v0.1 仅支持 macOS。

## 快速开始

### 1. 安装并启动（一行命令）

```bash
curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/install.sh | bash
```

这条命令会自动拉取代码、编译、接入 Claude Code 钩子，并启动宠物（在菜单栏找
🐾）。需要 Node.js 18+ 和 git。之后在终端里启动任意 `claude` 会话，宠物就会在
工具运行、权限提示、任务完成和出错时做出对应动画。

### 2. 更换宠物素材

打开 [codex-pets.net](https://codex-pets.net/)，挑一只宠物，记下它的 **slug**
（页面 URL 的最后一段，例如 `deepseek`），然后：

```bash
claude-pet import "https://codex-pets.net/api/pets/deepseek/download"
```

右键点击宠物（或点菜单栏 🐾）→ 在列表里选中它即可。也可以导入本地文件夹或
`.zip`：

```bash
claude-pet import ./my-pet
claude-pet import ./my-pet.zip
```

> 还没有链接 `claude-pet` 命令？用
> `node ~/.claude-pet/app/dist/cli/index.js import …` 代替。

### 3. 关闭（永久）

```bash
curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/uninstall.sh | bash
```

这会移除 Claude Code 钩子**并**退出应用——它不会再回来。加 `-s -- --purge`
可同时删除应用本体、宠物和设置：

```bash
curl -fsSL https://raw.githubusercontent.com/daghlny/claude-pet/main/uninstall.sh | bash -s -- --purge
```

（右键 → Quit 目前只是关闭窗口；上面这条一行命令才是真正的"关闭开关"。）

---

## 工作原理

1. 安装脚本会为以下 Claude Code 事件注册 `hooks/claude-pet-emit.sh`：
   `SessionStart`、`PreToolUse`、`PostToolUse`、`Stop`、`StopFailure`、
   `Notification`、`SessionEnd`。
2. 每次事件触发时，脚本记录来源终端应用 + tty，并向
   `~/.claude-pet/events.jsonl` 追加一行 JSON。
3. Electron 应用跟踪（tail）该文件，把每个事件映射到动画 + 气泡：

   | 事件                                  | 状态     | 气泡                      |
   |--------------------------------------|----------|--------------------------|
   | `SessionStart`                       | `jump`   | “Claude is ready.”       |
   | `PreToolUse`                         | `run`    | “Running &lt;tool&gt;…”        |
   | `Notification`（permission\_prompt） | `review` | “Needs your permission.” |
   | `Notification`（idle\_prompt）       | `wave`   | “Waiting on you.”        |
   | `Stop`                               | `wave`   | “Done — your turn.”      |
   | `StopFailure`                        | `failed` | error\_type              |
   | `SessionEnd`                         | `idle`   | “Session ended.”         |

4. 点击宠物 → AppleScript 会把当初运行 Claude Code 的那个具体
   Terminal.app / iTerm2 标签页提到最前（失败则退而激活应用，再不行则打开
   `cwd`）。

## CLI

```bash
claude-pet install     # 向 ~/.claude/settings.json 添加钩子条目
claude-pet uninstall   # 移除钩子条目
claude-pet status      # 查看安装状态 + 事件日志路径
claude-pet import <src># 导入宠物包（文件夹 | .zip | http(s) 的 .zip URL）
```

## 手动安装

如果你不想用管道执行 `bash`：

```bash
git clone https://github.com/daghlny/claude-pet.git
cd claude-pet
./install.sh                 # 与一行命令等价，只是在本地运行
# 或：./install.sh --no-hooks --no-launch  然后  npm start
```

## 宠物包格式（兼容 petdex / codex-pets）

```
my-pet/
├── pet.json
└── spritesheet.png      # 或 .webp
```

精灵图是一个帧网格：行代表状态，列代表动画帧。行顺序：
`idle, wave, run, failed, review, jump, extra1, extra2`。帧网格会从图片自动
探测，所以两种排布都能用（内置宠物是 9×8，每帧 192×208；codex 包是 8×9）。
最小化的 `pet.json`：

```json
{ "name": "Blob", "slug": "blob", "spritesheet": "spritesheet.png" }
```

codex-pets 的清单字段（`id` / `displayName` / `spritesheetPath`）会被自动接受
并归一化。宠物包存放在 `~/.claude-pet/pets/<slug>/`，导入器会替你拷贝过去。
内置的 `blob` 和 `cube` 由 `npm run gen:builtins` 程序化生成（仓库里没有二进制
美术资源）。

## 扩展到 macOS 之外

macOS 专属代码被隔离在 `hooks/claude-pet-emit.sh`（使用 `ps`，Linux 可直接用）
和 `src/main/focusTerminal.ts`（AppleScript，可替换为 `wmctrl` / PowerShell 并
按 `process.platform` 分派）。其余部分都是平台无关的。

## 许可证

MIT
