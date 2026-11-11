# 弹幕留言 · 开通与部署

后端代码已经写好在 `danmaku-api/`，前端在 `assets/js/danmaku.js` + `assets/css/danmaku.css`，
页面模板 `layouts/partials/danmaku.html`。

**当前已上线**：函数应用 `pill-danmaku`（East Asia，Linux 消耗计划，Node 20），
接口 `https://pill-danmaku.azurewebsites.net/api`，已填进 `hugo.toml` 的 `danmakuApi`。
存储用同一个资源组里的 `pan0020`（表 `danmaku`、容器 `images`）。

下面是**从零重建一遍**的步骤，留着以后换账号或重建时用。

---

## 一、开通存储账户（放留言数据）

1. 打开 <https://portal.azure.com>，用学生账号登录。
2. 搜索框输入 **存储账户** → 创建。
3. 填：
   - 资源组：新建一个，名字随意，比如 `pill-blog`
   - 存储账户名称：全局唯一，只能小写字母和数字，比如 `pilldanmaku`
   - 区域：选 **East Asia**（香港）或 **Southeast Asia**（新加坡），国内访问快
   - 性能：标准
   - 冗余：**LRS**（最便宜，本地冗余够用）
4. 创建完进这个存储账户 → 左侧 **访问密钥** → 复制「连接字符串」里 key1 那条。

> 学生订阅有 100GB 出站流量 + 存储额度，这个用量远远用不完。

## 二、开通函数应用（跑接口）

1. 搜索 **函数应用** → 创建。
2. 关键几项：
   - 发布方式：**代码**
   - 运行时堆栈：**Node.js**，版本 **20**
   - 操作系统：**Linux**
   - 计划类型：**消耗（Consumption）** ← 学生订阅免费额度在这里
   - 区域：和存储账户同一个
3. 创建完进函数应用 → 左侧 **环境变量**（旧版叫「配置」）→ 应用设置，加三条：

   | 名称 | 值 |
   |---|---|
   | `AzureWebJobsStorage` | 第一步复制的连接字符串 |
   | `IP_SALT` | 随便一串长随机字符，用来给 IP 加盐哈希 |
   | `WEBSITE_NODE_DEFAULT_VERSION` | `~20` |

4. 左侧 **CORS** → 添加两条来源：
   - `https://chorus7.github.io`
   - `http://127.0.0.1:8123`（本地预览用）

> 部署时踩过的坑，重建时照着避：
>
> 1. **`package.json` 必须有 `main`**，指向一个 import 了各函数模块的入口文件
>    （这里是 `src/index.js`）。Node v4 编程模型靠它找函数，缺了它
>    `GET /admin/functions` 返回空数组、路由全是 404。
> 2. **别设 `WEBSITE_RUN_FROM_PACKAGE=1`**。它会和 zipdeploy 打架，
>    站点直接 503（The service is unavailable）。
> 3. **`x-forwarded-for` 带端口**（形如 `1.2.3.4:27601`），
>    端口每次都变。拿它直接哈希会让同一台机器每次都被当成新访客、限频失效。
>    `danmaku.js` 的 `clientIp()` 已去掉端口。
> 4. 门户的「创建函数应用」页在部分网络下渲染空白，改用 ARM REST 建更快：
>    先 `POST .../providers/Microsoft.Web/register` 注册资源提供程序（未注册会报
>    `MissingSubscriptionRegistration`），再 PUT `serverfarms`（`Y1`/`Dynamic`/`kind:linux`）
>    和 `sites`（`linuxFxVersion: NODE|20`）。

## 三、拿到部署凭据

1. 函数应用 → 左侧 **概述** → 顶部点 **获取发布配置文件**，会下载一个 `.PublishSettings` 文件。
2. 打开这个文件，把**整个内容**复制下来（很长，是 XML）。
3. 到 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret，加三条：

   | 名称 | 值 |
   |---|---|
   | `AZURE_FUNCTIONAPP_NAME` | 函数应用的名字，比如 `pill-danmaku` |
   | `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` | 刚才复制的整个 XML |
   | `AZURE_STORAGE_CONNECTION` | 第一步复制的连接字符串（大图分流脚本用） |

> 发布配置文件等于部署密码。贴进 GitHub Secrets 是加密存储，
> 不要贴进聊天、不要提交到仓库。

## 四、部署并接入

1. 推一次 `danmaku-api/` 的改动，或者到 Actions 页面手动跑 **部署弹幕后端**。
2. 部署完成后，在函数应用 **概述** 页复制「默认域」，形如
   `https://pill-danmaku.azurewebsites.net`。
3. 接口地址就是它加 `/api`，填进 `hugo.toml`：

   ```toml
   danmakuApi = "https://pill-danmaku.azurewebsites.net/api"
   ```

4. 推上去，等 Pages 部署完成，文章页底部就会出现「说点什么」。

> **手动部署**（不走 Actions 时）：在 `danmaku-api/` 下 `npm install`，
> 把整个目录打成 zip，`POST` 到
> `https://<app>.scm.azurewebsites.net/api/zipdeploy?isAsync=true`，
> Basic 认证用发布配置文件里的 `userName` / `userPWD`。

### 验证

浏览器直接打开 `<接口地址>/danmaku`，应该返回：

```json
{"ok":true,"items":[]}
```

返回这个就说明后端通了。

---

## 接口说明

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/danmaku` | 取最新 60 条 |
| POST | `/api/danmaku` | 发一条，body `{"text":"...","color":"green"}` |

**限频**（按 IP 哈希，不存明文 IP）：

- 同一 IP 20 秒一条
- 每小时最多 10 条
- 每天最多 40 条

**内容限制**：

- 最多 80 字
- 不能含链接、脚本、iframe
- 拒绝零宽字符等不可见字符
- 颜色只接受白名单（`pink/green/yellow/blue/purple/orange`），防止注入任意 CSS

## 本地调试

```bash
cd danmaku-api
npm install
# 需要先装 Azure Functions Core Tools：npm i -g azure-functions-core-tools@4
func start
```

或者用 `~/blogwork/mock-danmaku.mjs` 那个假后端，不需要任何 Azure 账号就能调前端。

## 成本

消耗计划按调用次数计费，每月前 100 万次免费。
表存储按量计费，每条留言一行，几毛钱一个月都不到。
学生订阅额度覆盖得住。
