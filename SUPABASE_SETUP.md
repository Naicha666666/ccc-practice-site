# Supabase 登录和刷题记录设置

## 1. 创建 Supabase 项目

在 Supabase 新建一个免费项目。进入 Project Settings -> API，复制：

- Project URL
- anon public key

## 2. 创建刷题记录表

打开 Supabase SQL Editor，执行：

```sql
-- 直接粘贴并运行 supabase/schema.sql 的全部内容
```

这会创建 `public.user_question_progress`，并开启 RLS。每个登录用户只能读写自己的记录。

## 3. 本地开发环境变量

复制 `.env.example` 为 `.env.local`，填入你的 Supabase 信息：

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

重新启动开发服务器后，右上角会出现“登录 / 注册”。

## 4. Netlify 环境变量

在 Netlify 站点设置里进入：

Site configuration -> Environment variables

添加同名变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

然后重新部署。

## 5. 工作方式

- 未登录：刷题记录保存到浏览器 `localStorage`
- 登录后：本地记录会和 Supabase 云端记录合并，并同步到数据库
- 已登录：作答、收藏、错题、查看答案会自动保存到云端
- 退出登录：当前浏览器仍保留本地记录

题图和讲解视频仍放在 Netlify/外部视频项目，不进入 Supabase，避免产生大流量费用。
