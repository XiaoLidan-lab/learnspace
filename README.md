# LearnSpace

根据 V1.0 PRD 与原型实现的本地优先学习工作台。React + TypeScript + Vite，轻量 Express 服务端，IndexedDB 本地存储。

## 启动

```bash
npm install
npm run dev
```

浏览器打开终端显示的地址（默认 http://127.0.0.1:5173）。Node.js 18.20+，推荐 Node.js 22。

```bash
npm run test
npm run build
npm start
```

生产环境默认 http://127.0.0.1:3001。开发端口与生产端口的浏览器本地数据相互独立。

## 已实现

- 首页创建、打开、重命名、复制工作台结构、二次确认删除、搜索。
- 16 种模块（四大类）、多实例、12 列网格、桌面拖动标题移动、右下角缩放、复制、删除、编辑/学习模式、布局撤销重做、一键排版、分屏、标签堆叠、锁定与专注。
- IndexedDB 自动保存工作台、PDF 和笔记，刷新恢复；保存失败反馈与重试。删除布局/模块不删除私人资料，资料面板可访问归档笔记并下载 Markdown。
- PDF.js 真实 PDF 渲染、文本选择、翻页、缩放、上传与已有资料绑定（单文件最大 50 MB）。文件版本来源记录与页码回跳。
- 选段发到翻译、问答、笔记、总结或知识卡片；多目标选择；笔记追加确认；Markdown 文本编辑与独立笔记。
- 安全模板 JSON 导入（预览确认）与导出；版本、字段白名单、数量、边界与重叠校验。
- 内置模板分类、搜索、详情、预览与安装。安装后不复制私人内容。
- 登录、真实 AI 布局生成/调整/翻译/问答/总结/卡片/导图/测验，以及社区浏览/发布接口。需要以下配置。
- 移动端模块纵向排列，点击添加模块。

## 开通 AI、登录与在线社区

复制 `.env.example` 为 `.env`，填入 Supabase URL 与 anon key，以及服务端 AI key。Vite 与服务端均自动读取 `.env`；也可使用部署平台环境变量。密钥绝不能使用 `VITE_` 前缀。

在 Supabase SQL Editor 执行 `server/supabase.sql`，开启邮件登录，并将本地/生产 URL 加入 Auth redirect allowlist。前端与服务端必须使用同一个 Supabase 项目。

AI 接口验证 Supabase token，每用户每分钟最多 15 次，超时 55 秒，布局返回结果经过校验。布局调整先预览，再确认；预览期间工作台结构改变时拒绝应用。AI 不修改私人正文。

社区模板直接发布，无需人工审核。已有数据库请执行 `server/migrations/003_direct_publication.sql`，更新权限并公开此前待审核的模板。新数据库执行 `server/supabase.sql` 即可。登录校验和隐私触发器继续拒绝资源绑定、笔记、聊天等私人字段。爱心收藏保存在当前设备；书本按钮显示实际模块数并打开详情。

社区将“我的收藏 / 我的发布”放在一起，显示缩略图、分类、模块数，可查看和安装。发布时可以逐项附带 PDF、图片、视频文件、网页/视频链接、文本材料、字幕，以及逐篇勾选的笔记；默认均不勾选，聊天记录不共享。新数据库完整 SQL 已包含此功能，已有数据库执行 [004_shared_materials.sql](server/migrations/004_shared_materials.sql)。文件使用独立共享副本，单个最多 50 MB、合计最多 100 MB；文本和资料清单合计最多 512 KB。安装时可以选择只安装布局或一并保存共享资料与笔记。

未配置服务时，AI 不生成模拟回答。首页可使用明确标注的「内置推荐布局」；内置模板始终可安装。在线发布不会显示虚假的成功。

## 边界

应用已部署到 https://learnspace-lake.vercel.app，登录、数据库和 AI 使用用户配置的服务。PDF 来源目前定位到页码，不提供精确选段高亮。笔记采用 Markdown 文本编辑，不是富文本块编辑器。浏览器清除站点数据会删除本地资料；模板导出仅包含结构，不能作为私人数据完整备份。移动端使用纵向布局。

## 本次模块扩展交付

完整模块实现表、架构、数据迁移、测试范围、平台限制与手动验收步骤见 [docs/implementation.md](docs/implementation.md)。已有 Supabase 社区表请执行 [002_module_system.sql](server/migrations/002_module_system.sql)，本地 IndexedDB 无需清空或迁移。

## 邮件限流期间测试

已经实现邮箱密码登录：本地页面打开登录弹窗，选择「邮箱密码」。它使用 Supabase `signInWithPassword` 验证已有账号，不发送登录邮件。

如果没有测试账号，在 Supabase Dashboard → Authentication → Users 手动创建一个专用测试用户，设置邮箱与密码，并确认该用户的邮箱。请直接在控制台设置密码、在本地页面输入密码，不要写入 `.env` 或提交到代码仓库。确认单个受控测试用户即可，不需要关闭所有用户的邮箱验证规则。

不登录也可运行真实模型/数据库连接检查：

```bash
npm run test:live
```

该命令读取 `.env`，发送合成测试材料到配置的模型服务（会消耗模型额度），查询社区表并检查匿名访问控制，不发送登录邮件，也不发布模板。它不等同于登录后的完整交互验收。

成功登录后，在工作台内测试翻译、问答、AI 布局生成；再发布一个不含私人内容的测试模板。模板应直接进入 `published` 并显示在公开社区。

## Vercel 部署

已提供 `vercel.json`、`api/ai.ts`、`api/health.ts`，支持同一项目部署网页和 AI 接口。完整步骤与环境变量见 [docs/vercel-deployment.md](docs/vercel-deployment.md)。数据库、登录和共享资料继续使用 Supabase，部署不迁移 localhost 中的本地工作台。
