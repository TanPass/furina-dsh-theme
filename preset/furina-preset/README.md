# 芙宁娜·德·枫丹 — 可替换的 Agent 预设

这个目录是一份 **DSH Agent 预设**的源文件：

| 文件 | 作用 |
| --- | --- |
| `preset.yml` | 预设的显示元数据：`id`、`name`、`description`、`order`。 |
| `agent.cordis.yml` | 预设的插件行列表。第一行是 `@deepseek-ai/dsh-persona`，它的 `config.prefix` 就是芙宁娜的人格提示词；其余行与 DSH 的 standard 预设一致，负责工具、技能、压缩与子代理能力。 |

## 安装

在主题的 **设置 → 芙宁娜主题 → 人格预设 · PERSONA** 里点“安装预设”。主题会把这两份文件合成一行
`@deepseek-ai/dsh-agent-preset` 声明，追加到当前 profile 的 `cordis.patch.yml`，并备份原文件。
也可以在仓库根目录运行：

```powershell
node tools/install-preset.mjs
```

安装后重新打开 DSH（或让当前环境重新载入 profile patch），新建会话时即可在预设选择器里选
“芙宁娜·德·枫丹”。同一界面里的“移除预设”只删除主题写入的那一段，不会动其他预设。

## 替换成你自己的预设

`agent.cordis.yml` 与 `preset.yml` 都是普通的“可替换预设”源：

1. 复制 `preset/furina-preset` 到任意目录；
2. 改 `preset.yml` 的 `id` / `name` / `description`；
3. 把 `agent.cordis.yml` 里 `- id: persona` 的 `config.prefix` 换成你的人格提示词；
4. 用安装脚本的 `--preset <目录>` 参数安装，或把该目录放进主题包里后按上面的按钮安装。

不要把 `agent.cordis.yml` 写成 legacy 的 `$DSH_HOME/.agent-presets/<id>/` 目录——当前的 DSH
只从 profile patch 的 `@deepseek-ai/dsh-agent-preset` 声明行读取预设。

## 许可

人格文本为同人创作，角色《原神》芙宁娜 © HoYoverse / miHoYo；仅用于个人、非商业用途。
