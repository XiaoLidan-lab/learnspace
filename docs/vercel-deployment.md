# LearnSpace 部署到 Vercel

部署采用一个 Vercel 项目：Vite 生成的静态网页由 Vercel 托管，`api/ai.ts` 和 `api/health.ts` 作为 Node.js Functions 运行。登录、模板和共享文件继续使用已配置的 Supabase。无需在 Vercel 运行 `npm run dev` 或保持本地 3001 端口在线。

## 导入项目

1. 把项目代码提交到自己的 GitHub 仓库，不提交 `.env`、`.env.local`、`.vercel`。也可使用 Vercel CLI 从当前目录部署。
2. 在 Vercel 选择 Add New → Project，导入仓库，Root Directory 选择包含 `package.json` 的目录。
3. Framework 选择 **Vite**；Build Command 为 `npm run build`；Output Directory 为 `dist`。根目录 `vercel.json` 已提供这些设置及 API 超时配置。
4. Node.js Version 选择 **22.x**。
5. 在首次部署前配置下面的环境变量。变量取自本地 `.env`，直接填入 Vercel，不发送到聊天中。

| 变量 | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` | 浏览器连接 Supabase |
| `VITE_SUPABASE_ANON_KEY` | 浏览器使用的公开 anon key |
| `SUPABASE_URL` | AI 接口验证登录身份，与前端同项目 |
| `SUPABASE_ANON_KEY` | 服务端验证用户登录，与前端同项目 |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端调用共享配额 RPC；缺失时新 AI 请求返回 503 |
| `AI_BASE_URL` | 模型服务的 OpenAI 兼容基础地址 |
| `AI_API_KEY` | 仅服务端使用的模型密钥 |
| `AI_MODEL` | 当前使用的模型名称 |

同时配置 Production；若要测试预览环境，也给 Preview 配置变量。Vite 的 `VITE_` 变量会进入浏览器产物，因此模型密钥绝不能用 `VITE_` 前缀。修改构建环境变量后重新部署。

## 登录回跳

获得正式网址后，在 Supabase Authentication → URL Configuration：

- Site URL 设置为正式网址，例如 `https://learnspace.example.com` 或 Vercel 分配的正式域名。
- Redirect URLs 添加该域名的回跳地址，例如 `https://learnspace.example.com/`。
- 继续本地开发时保留 `http://127.0.0.1:5173/`；预览登录需要另外允许具体预览地址。

应用使用当前页面的 origin 作为邮件回跳地址，不需要把代码中的 localhost 改成线上域名。

## 验证部署

访问正式域名下的 `/api/health`，应得到 `ok: true`、`ai: true`、`auth: true`。然后在网站登录，测试一次问答、模板社区查询以及选择性资料分享。共享文件直接上传到 Supabase Storage，不经过 Vercel Function 的上传正文。

已有 Supabase 数据库和资料桶继续使用，不必每次部署重跑 SQL。先只读核对实际结构和迁移账本：004 共享材料、005/006 私人同步与 CAS、007 社区 V2、008 AI 配额；009 仅调整用户并发为 3。迁移必须单独审核并取得授权，不能由部署脚本自动执行。网页的私人工作台、文件、收藏仍存储在浏览器站点空间，localhost 和正式域名彼此独立，发布网站不会自动迁移本地内容。模板 JSON 导出只保留结构，不能备份全部笔记与文件。

AI 限流与并发控制由 Supabase RPC 原子管理，配额服务不可用时拒绝新请求，普通本地学习仍可使用。所有模型调用前预扣保守准入单位，含布局修复重试及长文档分段；准入单位不是人民币或准确 Token。应用请求总期限 50 秒，Function 上限 60 秒；若模型服务从部署区域无法访问，需检查供应商网络与区域要求。实际供应商预算、停服阈值及告警仍需人工核实，详见 [AI 配额运维说明](ai-quota-operations.md)。

## V2 Preview 发布流程

推送到非 main 的发布分支，利用现有 Git 集成创建 Preview；正式站点仍对应 main。先在 Preview 范围确认上表 8 项变量，尤其不要遗漏新增 service role key。服务端密钥不得使用 VITE_ 前缀；不要通过关闭配额保护修复 503。

Preview 是部署环境隔离，不自动建立独立 Supabase 数据库或模型预算。如果沿用当前 LearnSpace 项目，只能按已授权范围验证，不能把它称为独立数据库沙箱。密码登录与邮件回跳是不同验收项：邮件回跳需管理员批准后配置准确的 Preview URL，本次部署不自动修改 Auth 配置。

发布后检查部署的 commit 与分支、构建状态、首页与深链接、静态资源、`/api/health`、匿名 AI 拒绝以及错误 JSON。真实 AI、云端写入及配额实测须按各自授权执行。通过 Preview 不自动意味着生产 GO；正式上线前仍要核实供应商预算、恢复方案和未完成的共享配额实测。

已部署到 https://learnspace-lake.vercel.app，GitHub 公开仓库为 `XiaoLidan-lab/learnspace`。2026-10-14 验证网页、邮箱密码登录、真实 AI 问答、社区读取、收藏和附带笔记安装通过；健康检查 200，未登录 AI 请求 401，浏览器产物不含私密 AI Key。邮件链接登录仍需将正式域名加入 Supabase 的回跳允许列表，尚未验证该登录方式。

部署时修复了原生 Node ESM 对扩展名的要求：函数依赖图中的相对导入使用 `.js`，测试会将函数编译后用原生 Node 启动。若 Vercel 因提交邮箱无法匹配 GitHub 账号阻止部署，应为当前仓库设置该 GitHub 账号的 noreply 邮箱；不必改全局 Git 配置或重写已上传历史。

官方文档：[Vite 部署](https://vercel.com/docs/frameworks/frontend/vite)、[Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[函数时长](https://vercel.com/docs/functions/configuring-functions/duration)。
