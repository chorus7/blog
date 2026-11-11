# 写博客：手机 / 电脑都走 Obsidian

技术栈：Obsidian（写作）→ Git 插件（推送）→ GitHub Actions（构建）→ GitHub Pages（发布）

好处是整条链路不经任何第三方 API：图片和文字一起进 git，不会出现外链失效。

---

## 一、电脑端首次配置（约 10 分钟）

### 1. 克隆仓库到本地

仓库当前位置：`D:\#2AGENT\blog-src`（已克隆好）。

如果换电脑，重新 `git clone https://github.com/chorus7/blog.git` 即可。

### 2. 用 Obsidian 打开这个文件夹

Obsidian → 「打开本地仓库」→ 选中 `blog-src` 文件夹。

打开后 Obsidian 会在根目录建 `.obsidian/`，这是配置目录，会被提交（多端保持一致）。
`.gitignore` 已排除 `workspace.json` 和插件凭据，不用担心路径和 token 互相干扰。

### 3. 装并启用 Git 插件

设置 → 第三方插件 → 关闭安全模式 → 浏览 → 搜 `Obsidian Git` → 安装 → 启用。

启用后到插件设置里改两项：

| 设置项 | 建议值 | 说明 |
|---|---|---|
| Auto commit-and-sync interval | `10` 分钟 | 有改动就自动提交推送 |
| Commit message on auto commit-and-sync | `vault backup: {{date}}` | 默认即可 |

### 4. 配置 git 身份（只需一次）

插件用的是系统 git，确保已配置：

```bash
git config --global user.name "chorus7"
git config --global user.email "你的 GitHub 邮箱"
```

推送认证用 SSH 或 Personal Access Token，按你现有方式即可。

---

## 二、手机端配置

### 1. 装 App

App Store / 应用商店搜 **Obsidian**（免费）。

### 2. 装 Git 插件

Obsidian 移动版**不支持社区插件市场**，要手动装：

1. 电脑上打开 `blog-src/.obsidian/plugins/` 确认有 `obsidian-git` 文件夹
   （电脑端装好后会自动生成，随 git 一起同步到手机）
2. 手机端打开仓库后，设置 → 第三方插件 → 关闭安全模式 → 应该已能看到 Obsidian Git，启用它

如果手机上没看到插件，手动补：在电脑上把这个文件夹一起 commit 推上去，手机同步下来即可。

### 3. 手机端 clone 仓库

手机 Obsidian 首次打开会让你选仓库位置。用 **Clone an existing vault**，
填 `https://github.com/chorus7/blog.git`。

认证：GitHub 的 **Personal Access Token**（Settings → Developer settings → Tokens），
权限勾 `repo` 即可。密码认证已不被 GitHub 支持。

> Token 只存在手机本地，不进仓库——`.gitignore` 已排除 `plugins/obsidian-git/data.json`。

---

## 三、写一篇新随笔

### 目录结构（重要）

每篇文章是**一个文件夹**，不是单个 `.md` 文件：

```
content/posts/20261112-abc123/
├── index.md          ← 文章正文
├── cover.jpg         ← 图片放同目录
└── 随手拍.png
```

这就是 Hugo 的 page bundle。图片放同目录，引用时用相对路径，**图片就跟着文章一起永久保存在 git 里**。

### 步骤

1. 在 `content/posts/` 下新建文件夹，命名 `日期-短标识`，如 `20261112-abc123`
2. 文件夹里建 `index.md`，开头写：

```markdown
---
title: "文章标题"
date: 2026-11-12T20:30:00+08:00
draft: false
categories: ["日常"]
tags: ["记录"]
---

正文第一段。

![图片说明](cover.jpg)
```

3. 图片直接拖进这个文件夹，用上面的相对路径引用
4. 保存 → Git 插件自动提交推送（或手动点侧边栏的 Git 图标推送）
5. 等 1 分钟左右，Actions 构建完成，线上更新

### 手机端写法

手机上 Obsidian 写正文完全没问题。插图有两种方式：
- 手机相册分享到 Obsidian，它会插到当前笔记所在目录
- 注意 Obsidian 默认插图路径可能写到根目录 `assets/`，**建议在设置里改**：
  设置 → 文件与链接 → 新附件的默认位置 → 选「与当前笔记相同的文件夹」

这条改完，手机插图会自动落到文章文件夹里，引用路径也是相对的，不会错。

---

## 四、发布流程

```
写好 markdown（图片同目录）
    ↓  Git 插件自动 commit + push
main 分支
    ↓  GitHub Actions（deploy.yml）
Hugo 构建 → public/
    ↓  deploy-pages
https://chorus7.github.io/blog/
```

不需要再登录任何后台，也不需要手动跑脚本。

---

## 五、常用的事

| 想做的事 | 怎么做 |
|---|---|
| 看构建有没有成功 | GitHub → Actions 标签页，最新的 workflow 是否绿色 |
| 手动重新部署 | Actions → Deploy Hugo site to Pages → Run workflow |
| 草稿不发布 | frontmatter 里写 `draft: true`，构建时自动跳过 |
| 改站点配置 | `hugo.toml`，如标题、导航、页脚 |
| 本地预览 | 在 `blog-src` 下运行 `hugo server -D`，浏览器开 `localhost:1313/blog/` |
| 图片太多仓库变大 | 后续可换图床，但要注意外链失效风险 |

---

## 六、已做的改造

| 改动 | 原因 |
|---|---|
| 移除 Notion 同步链路（`scripts/` 整个目录） | Notion 国内访问不便，且图片 URL 一小时后失效 |
| `deploy.yml` 去掉同步步骤 | 原逻辑生成的 md 不 commit，runner 销毁后丢失，等于白跑 |
| 文章统一成 page bundle | 扁平 `.md` 无法存本地图片，统一后才能图文一起进 git |
| `.gitignore` 加 Obsidian 规则 | 排除工作区状态与插件凭据，保留配置多端同步 |
| 恢复 `contents: read` 权限 | 不再需要写仓库，避免 push 触发部署的死循环 |

---

## 七、已知的坑

1. **Obsidian Git 插件在手机上偶尔同步失败**，通常是 token 过期或网络问题。到插件设置里重填 token。
2. **附件默认路径**没改的话，手机插图会跑到 `assets/`，引用路径会错。按第三节改设置。
3. **不要删 `.obsidian/plugins/`**，那是插件本体，删了手机端就得重新装。
4. **文章文件夹名**建议只用英文、数字、连字符，避免中文路径在不同系统上的编码问题。
   URL 也干净。

---

## 八、组件来源（供 `assets/js/main.js` 头注释引用）

主题里的动效与交互不是凭空写的，逐个对应开源组件，按 `名称 / 源文件与许可 / 落地位置 / 证据` 记录如下。共 6 项，覆盖首页、文章页与全站页脚。

| # | 组件 | 源文件与许可 | 落地位置 | 证据 |
|---|---|---|---|---|
| 1 | 点击火花 ClickSpark | React Bits `DavidHDev/react-bits` `ClickSpark.jsx`，MIT + Commons Clause v1.0（© 2026 David Haz，不单独转售） | `assets/js/main.js` `initSpark()`，原生 canvas 改写 | 点击页面任意处，火花粒子从点击点扩散后归零；`reduceMotion` 下不创建 canvas |
| 2 | 数字滚动 number-pop-in | transitions.dev `02-number-pop-in.md`，个人/商用免费、禁再分发 | `layouts/partials/footer.html` 内联 `render()` + `assets/css/main.css` `.t-digit*` | 页脚「本站已运行 N 天」由服务端算天数、前端按位滚动渲染 |
| 3 | 标题入场 texts-reveal | transitions.dev `18-texts-reveal.md`，同上 | `assets/js/main.js` `initReveal()` + `.t-stagger` | 首页站名、文章/归档 h1 与 meta 分批入场，`prefers-reduced-motion` 直接显示 |
| 4 | 图标切换 icon-swap | transitions.dev `09-icon-swap.md`，同上 | `partials/header.html` 深浅色按钮 + `.t-icon-swap` | 主题按钮在 moon/sun 间切换，带缩放/模糊过渡 |
| 5 | 手风琴 accordion | transitions.dev `21-accordion.md`，同上 | `layouts/_default/single.html` TOC 折叠 + `main.js` `initAccordions()` | 窄屏文章页「目录」展开/收起，`aria-expanded` 同步 |
| 6 | 提示气泡 tooltip | transitions.dev `17-tooltip.md`，同上 | `main.js` `initTooltips()` + `.t-tt-*` | 主题按钮悬停/聚焦显示「切换深浅色」 |
| 7 | 图标（8 个） | Lucide `lucide-static v0.544.0`，ISC | `assets/icons/*.svg`，经 `partials/icon.html` `resources.Get` 引入 | 每份 SVG 头部保留 `@license lucide-static v0.544.0 - ISC` |

> 说明：第 7 项是图标库不是动效组件；动效组件合计 6 项。8 个图标分别是 `arrow-left`、`arrow-right`、`arrow-up-right`、`chevron-down`、`chevron-left`、`chevron-right`、`moon`、`sun`，模板里全部有实际引用；未用到的 `clock`、`external-link`、`list`、`menu`、`rss` 已删，不留死文件。SpotlightCard（React Bits）已读源码但**未采用**——它要求整卡悬停高亮，与本主题「禁用卡片 hover 上浮」的反套路约定冲突，故舍去。