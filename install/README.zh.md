# Furina DSH 主题整合包（主题 + 启动动画）

一次安装两个插件：

- `furina-dsh-theme-1.1.1.tgz` — 芙宁娜主题（3 套皮肤、设置页壁纸切换、侧边栏/文字随皮肤换色、启动画面配色、深色文件卡片、电力储备面板、设置页内启动动画开关）
- `dsh-startup-screen-1.1.0.tgz` — 配套启动动画插件（原作者沈宏宏，MIT，源码也收在主题仓库 `companion/` 里）

## Windows 一键安装

双击 **`install.cmd`**，或在 PowerShell 里运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会按顺序把两个包装进 `web` profile（`dsh plugin --profile web add ...`）。完成后：

1. 重启一次 DSH web 进程（关掉运行 `dsh web` 的终端再启动），让 host 端和插件清单重新加载；
2. 刷新浏览器页面。

装好后打开 **设置 → 芙宁娜主题**：最下方就是「启动动画 · Startup」，可以开关、选择播放模式，或点「打开完整设置」进入插件自己的 33 项设置页。

## 卸载

```powershell
dsh plugin --profile web remove furina-dsh-theme
dsh plugin --profile web remove dsh-startup-screen
```

然后重启 DSH web。安装脚本只通过 `dsh plugin` 修改 profile 的 package.json / cordis.patch.yml；如有自定义，请先备份这两个文件。

## 说明

- 需要 DSH 0.2.x（在 0.2.1-rc.2 验证）与 Node >= 22。
- 主题代码 MIT；壁纸为芙宁娜同人图（© HoYoverse），仅限个人非商业使用，详见主题仓库 `NOTICE.md` / `CREDITS.md`。
- 启动动画是可选插件：只装主题时，「启动动画」区块会自动禁用并提示，其余功能不受影响。
