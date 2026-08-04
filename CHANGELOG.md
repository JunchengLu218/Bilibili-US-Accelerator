# Changelog

## 0.2.0 - 2026-08-04

- 将 MCDN（`*.mcdn.bilivideo.cn/com/net`）改写到 `proxy-tf-all-ws.bilivideo.com`，缓解海外环境下长时间 0KB。
- 补充对应 MitM 主机名。
- 新增 [docs/SPEED-TEST.md](docs/SPEED-TEST.md)：iPad/iOS 上普通版与国际版速度不稳的 A/B 测试与主机名归类方法。
- 稳定版仍不改写 Akamai / BStar，避免花屏。

## 0.1.0 - 2026-08-03

- 固定普通 Bilibili UPOS/HK 视频 CDN 到 `upos-sz-mirrorali.bilivideo.com`。
- 保留原始协议、路径、Range 和查询参数。
- 排除 Akamai 改写，避免 `os=akam`/`hmac` 分片跨 CDN 后发生花屏。
- 确认兼容 Loon 3.5.0 的旧式 `header` Rewrite 语法。
- 已在纽约网络环境下验证多个 4K/杜比视频，当前版本以稳定性为优先。
