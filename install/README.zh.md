# Furina DSH 主题整合包（主题 + 启动动画）

一次安装两个插件：

- `furina-dsh-theme-1.2.8.tgz` — 芙宁娜主题（3 套皮肤、设置页壁纸切换、侧边栏/文字随皮肤换色、启动画面配色、深色文件卡片、电力储备面板、设置页内启动动画开关）
- `dsh-startup-screen-1.1.0.tgz` — 配套启动动画插件（原作者沈宏宏，MIT，源码也收在主题仓库 `companion/` 里）

## Windows 一键安装

双击 **`install.cmd`**，或在 PowerShell 里运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会按顺序把两个包装进 `web` profile（`dsh plugin --profile web add ...`），最后做一次官方预设自检。完成后：

1. 重启一次 DSH web 进程（关掉运行 `dsh web` 的终端再启动），让 host 端和插件清单重新加载；
2. 刷新浏览器页面。

装好后打开 **设置 → 芙宁娜主题**：最下方就是「启动动画 · Startup」，可以开关、选择播放模式，或点「打开完整设置」进入插件自己的 33 项设置页。

## 官方预设自检（标准 / PTC / 极简 / 创造）

DSH 自带的 4 个预设来自 `@deepseek-ai/dsh-web-app` bundle。在 DSH 0.2.2 上，如果 profile 同时装了
**billion-context**，它的 bundle patch 会让这 4 条预设行等待 `biliBasicCompactionPolicy` 服务；而 0.2.2
上这个服务到不了 preset 作用域，于是 4 条预设一直 `pending`，新建会话菜单里只剩自定义预设。

安装脚本第 3 步会检测这种组合（`dsh.profile.bundles` 里同时有 billion-context 和 dsh-web-app），
在 profile 的 `cordis.patch.yml` 末尾追加一段带标记的覆盖，清空这 4 条 preset 的 `inject`：

```yaml
# [furina-dsh-pack] shipped preset compatibility - begin
- id: preset-standard
  inject: []
# … ptc / minimal / cordis …
# [furina-dsh-pack] shipped preset compatibility - end
```

写入前会备份 patch 文件；重复运行不会重复追加；没装 billion-context 时什么都不做。
profile patch 在所有 bundle 层之后应用，所以这几行能覆盖 billion-context 的注入；
billion-context 本身保持安装、不受影响。想撤销就删掉这段标记块并重启 `dsh web`。

## 卸载

```powershell
dsh plugin --profile web remove furina-dsh-theme
dsh plugin --profile web remove dsh-startup-screen
```

然后重启 DSH web。安装脚本只通过 `dsh plugin` 修改 profile 的 package.json / cordis.patch.yml；如有自定义，请先备份这两个文件。

## 说明

- 需要 DSH 0.2.x（在 0.2.2-rc.1 验证）与 Node >= 22。
- 主题代码 MIT；壁纸为芙宁娜同人图（© HoYoverse），仅限个人非商业使用，详见主题仓库 `NOTICE.md` / `CREDITS.md`。
- 启动动画是可选插件：只装主题时，「启动动画」区块会自动禁用并提示，其余功能不受影响。
