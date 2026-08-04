# Bilibili US Accelerator for Loon

给纽约及北美网络环境使用的 Bilibili 官方 iOS/iPadOS App CDN 固定改写插件。

当前稳定版会把普通 Bilibili UPOS/HK 视频分片固定改写到：

```text
upos-sz-mirrorali.bilivideo.com
```

并把 MCDN（`*.mcdn.bilivideo.cn` 等）改写到官方中转：

```text
proxy-tf-all-ws.bilivideo.com
```

Akamai / 国际版 BStar（`upos-bstar*-mirrorakam.akamaized.net`）分片保持原样，避免专用签名或 Range 与 UPOS 镜像不匹配造成花屏。

播放速度在 1MB+ 与 0KB 之间跳动时，先按 [docs/SPEED-TEST.md](docs/SPEED-TEST.md) 做 Loon A/B 对照，确认卡顿时的真实主机名再决定是否换 CDN。

## 一键安装

[在 Loon 中安装稳定版](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fgithub.com%2FJunchengLu218%2FBilibili-US-Accelerator%2Freleases%2Flatest%2Fdownload%2FBilibili-US-Accelerator.plugin)

也可以在 Loon 的插件页面添加下面的远程 URL：

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Accelerator.plugin
```

```text
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/Bilibili-US-Accelerator.plugin
```

## 推荐设置

- Loon 代理模式：`TUN Only`
- Loon 流量模式：`自动分流`
- MitM 证书：已安装并在系统中完全信任

安装后完全退出 Bilibili App 再重新打开。普通 UPOS 视频的请求记录中，“修改后的链接”应使用 `upos-sz-mirrorali.bilivideo.com`；MCDN 应变为 `proxy-tf-all-ws.bilivideo.com`；`upos-*-mirrorakam.akamaized.net` 与国际版 `upos-bstar*-mirrorakam.akamaized.net` 应保持原样。

## 速度不稳时

播放显示有时 1MB+、有时 0KB，先不要连续换插件。按 [速度排查手册](docs/SPEED-TEST.md) 用 Loon 对照「原始 Host / 修改后 Host」，区分普通 UPOS、MCDN、Akamai 和国际版 BStar。

## 更新

稳定版插件 URL 永久保持不变。发布新版本后：

1. 在 Loon 中开启该插件资源的自动更新或设置更新间隔。
2. 也可以点击插件页面的更新按钮。
3. 或打开 [更新所有 Loon 订阅资源](https://www.nsloon.com/openloon/update?sub=all)。

Loon 拉取更新后，可以在插件详情中查看 `#!version` 是否发生变化。

## 致谢

问题定位参考了 [BiliUniverse/Redirect issue #10](https://github.com/BiliUniverse/Redirect/issues/10) 以及 [bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 的 CDN 分类思路。

## 免责声明

本项目是个人网络兼容性配置，与哔哩哔哩、Loon 或上述开源项目均无隶属关系。请遵守当地法律、平台条款和内容授权规则。
