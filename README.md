# gpt_img

一个最小可运行的 Next.js 绘图页 demo，现已改为通过服务端代理访问 chatgpt2api 兼容图像接口，适合本地开发和 Cloudflare 友好部署。

功能特性：
- 文生图调用本地代理 POST /api/images/generations
- 图生图调用本地代理 POST /api/images/edits
- 服务端转发到上游 ${API_URL}/v1/images/generations 与 ${API_URL}/v1/images/edits
- 浏览器每次请求都必须携带 Authorization: Bearer ***
- 服务端校验 AUTH_KEY，不匹配返回 401
- 服务端不再使用 API_KEY 二次转发，而是沿用浏览器提交的 Bearer token 请求上游
- 图生图继续使用 multipart/form-data，并保留重复 image 字段
- 本地会话历史与参考图体验保持不变
- 路由声明为 Edge runtime，更利于 Cloudflare 场景

## 环境变量

复制示例文件后填写：

```bash
cp .env.example .env.local
```

`.env.local` 中需要：

```env
API_URL=https://your-chatgpt2api.example.com
AUTH_KEY=your_b..._key
```

说明：
- API_URL: chatgpt2api 或其他 OpenAI 兼容图片接口的基础地址，不要以 /v1/images/... 结尾
- AUTH_KEY: 浏览器调用本站代理接口时必须填写的 auth-key，服务端会先用它校验本地代理请求，再将同一个 Bearer token 原样转发到上游
- API_KEY: 当前前端代理链路不会读取这个变量；如果 `.env` 里保留了 API_KEY，也不会参与图片请求鉴权

## 本地启动

```bash
npm install
npm run dev
```

打开 http://localhost:3000

页面中：
- 输入 Auth Key，即 `.env.local` 中配置的 AUTH_KEY
- 输入提示词
- 选择文生图或图生图
- 生成历史会保存在 localStorage

## 请求链路

浏览器不会再直接请求任意第三方地址，而是只请求本站：

- POST /api/images/generations
- POST /api/images/edits

服务端会：
1. 校验请求头 Authorization: Bearer ***
2. 将请求转发到 API_URL 对应的上游接口
3. 原样转发同一个 Authorization: Bearer ***
4. 将上游响应原样返回给前端

这和 basketikun/chatgpt2api 项目的使用方式一致：客户端直接用 Bearer token 访问兼容接口，不额外引入 API_KEY 中转。

如果 auth-key 不正确，将返回 401 Unauthorized。

## Cloudflare 部署说明

本项目已尽量采用 Cloudflare 友好的方式：
- 前端不直连第三方 API，避免浏览器侧直接暴露目标基础地址
- 路由处理器使用 Edge runtime
- 代理逻辑基于标准 fetch / Request / Response / FormData

推荐部署方式：
1. 将项目部署到支持 Next.js App Router 与 Edge 路由的 Cloudflare 方案
2. 在 Cloudflare 的项目环境变量中配置：
   - API_URL
   - AUTH_KEY
3. 前端用户访问页面时，输入与 AUTH_KEY 一致的 auth-key
4. 若上游是 chatgpt2api，请确保其服务端也配置了相同或你预期的 Bearer 鉴权规则

部署后检查：
- 页面请求目标应为本站 `/api/images/*`
- 上游 API 只应由服务端访问
- 图生图上传应仍然为 multipart/form-data
- 上游收到的 Authorization 应与前端提交值一致

## 构建

开发修改后可执行：

```bash
npm run build
```

如果需要部署到 Cloudflare，请同时确认目标平台对当前 Next.js 版本与 Edge 路由支持情况。
