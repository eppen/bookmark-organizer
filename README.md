# 书签整理（Chrome 扩展）

独立全屏管理页：树形拖拽、搜索、查重合并、规则/AI 分类、失效链接检测、导入导出。

## 安装

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录 `bookmark-organizer`
4. 点击工具栏图标，打开管理页

## 功能

| 功能 | 说明 |
|------|------|
| 书签树 | 展开/折叠、拖拽移动、双击重命名、右键菜单 |
| 搜索 | 按标题 / URL 过滤并高亮 |
| 查重 | 规范化 URL 后分组，确认后删除重复项 |
| 规则分类 | 域名 / 关键词 → 文件夹路径（相对书签栏） |
| AI 分类 | OpenAI 兼容 API，预览建议后确认移动 |
| 失效检测 | 可配置并发与超时，可删除失败项 |
| 导入导出 | JSON（自有格式）与 Netscape HTML |

## AI 设置

在「设置」中填写：

- API Base URL（默认 `https://api.openai.com/v1`）
- API Key
- 模型名（如 `gpt-4o-mini`）

也支持其它 OpenAI 兼容网关（改 Base URL 即可）。Key 保存在 `chrome.storage.local`。

## 权限说明

- `bookmarks`：读写书签
- `storage`：保存设置与规则
- `tabs`：打开管理页 / 书签
- `<all_urls>`：失效链接检测与调用你配置的 AI API

## 目录

```
bookmark-organizer/
  manifest.json
  background.js
  manager.html
  css/manager.css
  js/…
  icons/
```
