# Changelog

## 1.2.0 - 2026-08-03

- 固定普通 Bilibili UPOS/HK 视频 CDN 到 `upos-sz-mirrorali.bilivideo.com`。
- 保留原始协议、路径、Range 和查询参数。
- 排除 Akamai 改写，避免 `os=akam`/`hmac` 分片跨 CDN 后发生花屏。
- 确认兼容 Loon 3.5.0 的旧式 `header` Rewrite 语法。
- 已在纽约网络环境下验证多个 4K/杜比视频，当前版本以稳定性为优先。
