# Cloudflare R2 视频接入

当前视频在 `/home/eason/CCC`，命名类似：

```txt
/home/eason/CCC/2025/CCC2025Q01.mp4
```

网站使用根目录的 `videos.json` 连接视频。每条记录格式：

```json
{
  "2025-1": {
    "title": "2025 Q1 讲解",
    "url": "https://your-public-r2-domain/2025/CCC2025Q01.mp4"
  }
}
```

## 1. 创建 R2 bucket

1. 打开 Cloudflare Dashboard
2. 进入 R2 Object Storage
3. 创建 bucket，例如 `ccc-videos`
4. 使用 Standard storage

## 2. 上传视频

把 `/home/eason/CCC` 里的年份目录上传到 bucket 根目录，保持结构不变：

```txt
2014/CCC2014Q01.mp4
2014/CCC2014Q02.mp4
...
2025/CCC2025Q25.mp4
```

可以用 Cloudflare 控制台网页上传，也可以用 `wrangler r2 object put` 批量上传。

## 3. 开启公开访问

在 R2 bucket 设置里开启 Public access，拿到公开访问域名，例如：

```txt
https://pub-xxxx.r2.dev
```

如果你绑定自己的域名，也可以用：

```txt
https://videos.your-domain.com
```

## 4. 生成 videos.json

拿到公开域名后，在本项目根目录运行：

```bash
node scripts/generate-videos-json.mjs /home/eason/CCC https://pub-xxxx.r2.dev
```

脚本会扫描视频文件，并重写根目录 `videos.json`。

如果你上传到 bucket 里的路径带了额外前缀，例如：

```txt
ccc-videos/2014/CCC2014Q01.mp4
```

运行时加第三个参数：

```bash
node scripts/generate-videos-json.mjs /home/eason/CCC https://videos.your-domain.com ccc-videos
```

## 5. 验证

运行：

```bash
npm run build
npm run dev
```

打开任意已有视频的题目页，例如 `/practice/2025/1`，右侧视频区域会出现视频讲解链接。

当前本机检测到 295 个视频，缺少：

```txt
2014-21
2017-21
2018-9
2022-17
2025-17
```
