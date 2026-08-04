# Bilibili US Accelerator for Loon（BStar 测试分支）

> **这是测试分支，不是稳定版。** 国际版 BStar 改写可能出现花屏、403 或无加速。日常请继续用 [main / Releases](https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest)。

在普通版 UPOS→`mirrorali` 之外，额外把国际版：

```text
upos-bstar-mirrorakam.akamaized.net
upos-bstar1-mirrorakam.akamaized.net
```

改写到与普通版相同的：

```text
upos-sz-mirrorali.bilivideo.com
```

普通港澳台 Akamai（`upos-hz-mirrorakam` 等）仍不改写。

## 安装测试版

Loon 插件远程 URL（指向本分支）：

```text
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/cursor/bstar-rewrite-test-9152/Bilibili-US-Accelerator.plugin
```

[在 Loon 中安装本测试分支](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FJunchengLu218%2FBilibili-US-Accelerator%2Fcursor%2Fbstar-rewrite-test-9152%2FBilibili-US-Accelerator.plugin)

安装后：停用稳定版插件 → 启用本测试插件 → 完全退出国际版 App 再打开。

## 怎么判断有没有生效

1. 用**家庭 WiFi 或移动网络**测（公寓 WiFi 先排除）。
2. Loon 请求里，国际版分片的「修改后的链接」应为 `upos-sz-mirrorali.bilivideo.com`。
3. 记录：能否播、速度、是否花屏/绿屏、是否大量 403。
4. 出问题立即切回稳定版。

## 推荐设置

- Loon 代理模式：`TUN Only`
- Loon 流量模式：`自动分流`
- MitM 证书：已安装并在系统中完全信任
- 不要同时启用 BiliUniverse Redirect 等其它 Bilibili CDN 改写

## 免责声明

本分支仅用于个人对照测试，与哔哩哔哩、Loon 均无隶属关系。请遵守当地法律、平台条款和内容授权规则。
