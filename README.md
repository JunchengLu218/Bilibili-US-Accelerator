# BiliBili CDN NYC Fix for Loon 3.5.0

给纽约及北美网络环境使用的 Bilibili 官方 iOS/iPadOS App CDN 固定改写插件。

当前稳定版会把普通 Bilibili UPOS/HK 视频分片固定改写到：

```text
upos-sz-mirrorali.bilivideo.com
```

Akamai 分片保持原样，避免 Akamai 专用签名或 Range 与 UPOS 镜像不匹配造成花屏。

## 一键安装

[在 Loon 中安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FJunchengLu218%2FBiliBili-CDN-NYC-Fix%2Fmain%2FBiliBili-CDN-NYC-Fix-Loon-3.5.0.plugin)

也可以在 Loon 的插件页面添加下面的远程 URL：

```text
https://raw.githubusercontent.com/JunchengLu218/BiliBili-CDN-NYC-Fix/main/BiliBili-CDN-NYC-Fix-Loon-3.5.0.plugin
```

> 如果之前安装的是本地文件版，请先停用或删除本地版本，再使用上面的远程 URL 安装。只有远程订阅版本才能从 GitHub 获取后续更新。

## 推荐设置

- Loon 代理模式：`TUN Only`
- Loon 流量模式：`自动分流`
- MitM 证书：已安装并在系统中完全信任
- 不要同时启用 BiliUniverse Redirect、旧版 Auto 插件或另一份相同改写

安装后完全退出 Bilibili App 再重新打开。普通 UPOS 视频的请求记录中，“修改后的链接”应使用 `upos-sz-mirrorali.bilivideo.com`；`upos-*-mirrorakam.akamaized.net` 应保持原样。

## 更新

远程插件 URL 永久保持不变。仓库更新后：

1. 在 Loon 中开启该插件资源的自动更新或设置更新间隔。
2. 也可以点击插件页面的更新按钮。
3. 或打开 [更新所有 Loon 订阅资源](https://www.nsloon.com/openloon/update?sub=all)。

Loon 拉取更新后，可以在插件详情中查看 `#!version` 是否发生变化。

## 维护方式

每次修改：

1. 编辑 `BiliBili-CDN-NYC-Fix-Loon-3.5.0.plugin`。
2. 提高文件头部的 `#!version`，例如 `1.2.0` → `1.2.1`。
3. 在 `CHANGELOG.md` 记录变更和测试结果。
4. 运行 `./scripts/validate.sh`。
5. 提交并推送到 `main`；Loon 的远程地址不需要修改。

建议任何 CDN 调整都先确认以下三类视频：普通 4K、杜比/高码率、原始 Akamai 地址。不要把包含 `upsig`、`hmac`、`mid`、`buvid` 等完整查询参数的请求截图提交到 Issue。

## 当前设计边界

- 只做请求主机改写，不读取或修改视频响应体。
- 保留原始 HTTP/HTTPS、路径、Range 和完整查询参数。
- 不改写 Akamai。
- 不自动测速或动态轮换节点；稳定性优先。

## 致谢

问题定位参考了 [BiliUniverse/Redirect issue #10](https://github.com/BiliUniverse/Redirect/issues/10) 以及 [bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 的 CDN 分类思路。

## 免责声明

本项目是个人网络兼容性配置，与哔哩哔哩、Loon 或上述开源项目均无隶属关系。请遵守当地法律、平台条款和内容授权规则。
