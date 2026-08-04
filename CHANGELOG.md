# Changelog

## 0.2.0 - 2026-08-04（BStar 测试分支）

- **实验**：将国际版 BStar（`upos-bstar*-mirrorakam.akamaized.net`）改写到 `upos-sz-mirrorali.bilivideo.com`。
- 普通版 UPOS/HK 行为与 0.1.0 相同。
- 仍不改写 `upos-hz-mirrorakam` 等非 BStar Akamai。
- 可能花屏/403；仅供测试，不作为稳定发布。

## 0.1.0 - 2026-08-03

- 固定普通 Bilibili UPOS/HK 视频 CDN 到 `upos-sz-mirrorali.bilivideo.com`。
- 保留原始协议、路径、Range 和查询参数。
- 排除 Akamai 改写，避免 `os=akam`/`hmac` 分片跨 CDN 后发生花屏。
- 确认兼容 Loon 3.5.0 的旧式 `header` Rewrite 语法。
- 已在纽约网络环境下验证多个 4K/杜比视频，当前版本以稳定性为优先。
