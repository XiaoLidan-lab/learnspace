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

已有 Supabase 数据库和资料桶继续使用，不必每次部署重跑 SQL；未升级的数据库按 002、003、004 顺序执行。网页的私人工作台、文件、收藏仍存储在浏览器站点空间，localhost 和正式域名彼此独立，发布网站不会自动迁移本地内容。模板 JSON 导出只保留结构，不能备份全部笔记与文件。

当前 AI 限流保存在函数实例内存，属于每实例保护，不是跨实例的全站配额。开放给大量用户前需要共享限流和模型预算控制。AI 请求已配置 55 秒服务超时和 60 秒 Function 上限；若模型服务从部署区域无法访问，需检查供应商网络与区域要求。

此配置已通过本地构建和 API 入口验证，尚未创建 Vercel 项目或实际部署；上线后仍须完成正式域名上的功能检查。

官方文档：[Vite 部署](https://vercel.com/docs/frameworks/frontend/vite)、[Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)、[函数时长](https://vercel.com/docs/functions/configuring-functions/duration)。
