# 重生成意见 (Regen Feedback)

SillyTavern / TauriTavern 扩展：**重新生成之前，先告诉 AI 上一轮哪里不对**。

平时点「重新生成」，AI 只知道「再来一遍」，同样的毛病还会再犯一次。这个扩展在最后一条 AI 回复上加一个 💬 按钮，点开写两句意见——「太啰嗦」「角色出戏了」「没接住我的设定」——再带着这些意见重新生成。写的时候还能直接点 QR 助手里的快速回复，把常用意见一键插进去。

## 功能

- **最后一条回复上的 💬 按钮**：点开即写意见，不用离开聊天。
- **QR 快速回复**：面板里列出你在 Quick Reply v2 里可见的快速回复（和 QR 助手菜单读的是同一批数据），点一下插入到光标处，可以连点。
- **两条通道**：
  - 单聊：走酒馆自带的 `quiet_prompt` 通道，意见拼在最后一条用户消息尾部一起发送。
  - 群聊：走临时系统提示注入（`IN_CHAT` 深度 0），生成结束自动清理。
- **直接重生成**：不想写意见时，面板里也有一个按钮，效果和原生「重新生成」一致。
- **不碰核心文件**：只在消息行动栏插入一个按钮节点，不改 `script.js`、不改模板。

## 安装

### 方式 A：酒馆里装（推荐）

1. 打开「扩展」面板 → 「安装扩展」。
2. 填入仓库地址：
   ```
   https://github.com/y145-cloud/SillyTavern-Regen-Feedback.git
   ```
3. 点安装，然后刷新页面。

### 方式 B：手动解压

1. 下载 zip：<https://github.com/y145-cloud/SillyTavern-Regen-Feedback/archive/refs/heads/main.zip>
2. 解压出 `SillyTavern-Regen-Feedback-main` 文件夹，重命名为 `st-regen-feedback`。
3. 放到 `SillyTavern/public/scripts/extensions/third-party/st-regen-feedback/`。
4. 刷新页面。

> TauriTavern 同理：放进它的 `scripts/extensions/third-party/` 目录后重启应用。

## 使用

1. 等 AI 回复完（或按 ⏹ 停止）。
2. 最后一条回复的行动栏里会出现 💬 图标，点它。
3. 写意见（或点快速回复插入常用话术）。
4. 点「带着意见重新生成」。

生成的提示里会多出一段：

```
【重生成要求】上一轮把角色写得太软了，而且没接住「雨夜」这个设定；请保持冷硬语气。
```

想临时不带意见重来，就点「直接重生成」；想关掉清空逻辑，取消勾选「生成后清空」。

## 设置

扩展面板 →「重生成意见」：

| 开关 | 默认 | 说明 |
| --- | --- | --- |
| 启用扩展 | ✅ | 总开关 |
| 在最后一条回复上显示按钮 | ✅ | 关掉后仍可从设置面板打开 |
| 显示 QR 助手的快速回复 | ✅ | 读取 Quick Reply v2 中可见的集合 |
| 生成后清空意见 | ✅ | 下次打开是空的 |

## 它是怎么把意见送进去的

单聊走酒馆原生的附加提示通道（`quiet_prompt` + `quietToLoud`），也就是 `$('#option_regenerate').trigger('click', [{ additionalPrompt }])`，酒馆自己的 `buildOrFillAdditionalArgs()` 会把它拼到最后一条消息末尾；组聊的 `regenerateGroup()` 不吃这个参数，所以改用一次性的 `setExtensionPrompt(IN_CHAT, depth 0, SYSTEM)`，在 `GENERATION_ENDED` / `GENERATION_STOPPED` 时清掉。

## 已知限制

- 只对**最后一条** AI 回复显示按钮——重生成中间楼层在酒馆里没有意义。
- 快速回复只列 Quick Reply v2 的文本型快速回复；QR 助手菜单里的 JS 脚本按钮 / 小白盒任务 / DOM 按钮不是文本，插进来没有意义，所以不列。
- 生成过程中按钮会被酒馆原生 CSS 隐藏（`body[data-generating]` 规则），这是有意为之。

## 卸载

删掉 `public/scripts/extensions/third-party/st-regen-feedback/` 目录即可，不留残留配置（设置在 `localStorage` 的 `stRegenFeedback` 里，可一并清掉）。

## 更新日志

### 1.0.0

- 初始版本：💬 按钮、意见面板、QR 快速回复插入、单聊 `quiet_prompt` / 群聊系统注入两条通道。

## 许可

MIT
