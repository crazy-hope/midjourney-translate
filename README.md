# MJ 中文提示词翻译

一个无后端的 Chrome Manifest V3 扩展，在 Midjourney 官网的原生提示词输入框下方增加中文翻译面板。

## 安装

1. 打开 Chrome，进入 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本 `mj-prompt-translator` 目录。
5. 建议将扩展固定到工具栏。

## 使用

1. 点击扩展图标，再点击“打开 / 定位 Midjourney”。
2. 扩展会切换到已打开的 Midjourney 标签页，或新建官网标签页。
3. 在 Midjourney 原生输入框下的中文面板中输入描述。
4. 调整画幅比例、风格化、混乱度、质量和 HD 开关。
5. 点击“翻译并填入”，检查英文结果后再手动向 Midjourney 提交。

也可使用 `Ctrl+Enter`（macOS 为 `Command+Enter`）触发翻译。扩展不会自动提交 Midjourney 任务。

## 翻译通道

### 免费翻译

默认使用 MyMemory 公共翻译接口，不需要密钥。该服务是第三方公共服务，可能有频率限制或短暂不可用。由于单次请求上限为 500 个 UTF-8 字节，扩展会自动将长文本分段并合并结果。

### 千问

默认建议值：

- API 地址：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- 模型：`qwen-plus`

请填入自己申请的 API Key，然后点击“测试连接”。

### DeepSeek

默认建议值：

- API 地址：`https://api.deepseek.com/chat/completions`
- 模型：`deepseek-flash`

请填入自己申请的 API Key，然后点击“测试连接”。

## Midjourney 参数

默认追加：

- `--ar 16:9`
- `--stylize 450`
- `--chaos 8`

`--quality` 默认为“自动”，即不添加任何参数；可选 `1`、`2`、`4`。`--hd` 默认关闭，主要适用于支持 HD 的 Midjourney V8.1/V8.2。

如果你在中文输入中已手动写入 `--ar`、`--stylize`、`--chaos`、`--quality` 或 `--hd`，手写值优先，面板不会重复追加同类参数。

## 数据与安全

- 服务选择、端点、模型名、API Key 和 Midjourney 参数只保存到 `chrome.storage.local`。
- 扩展没有自建后端，不保存翻译历史。
- 中文提示词会发送给你当前选择的翻译提供方。
- API Key 不会被注入 Midjourney 页面，但浏览器本地存储并不等同于系统级密钥保险箱。

详见 [PRIVACY.md](PRIVACY.md)。

## 故障排查

- **页面没有出现中文面板**：刷新 Midjourney 页面，确认扩展已启用，并进入包含 Imagine 输入框的页面。
- **模型接口无法访问**：重新保存设置并允许扩展访问该 API 域名。
- **401/403**：检查 API Key、接口地址和账户权限。
- **429**：免费额度或请求频率已达限制，请稍后重试。
- **Midjourney 改版后无法填入**：在 `chrome://extensions/` 重新加载扩展并刷新页面。

## 重置或卸载

要清除配置，可在 `chrome://extensions/` 删除扩展后重新加载。卸载扩展会删除该扩展在 Chrome 中保存的本地设置。

## 开发检查

```bash
npm test
npm run validate
```
