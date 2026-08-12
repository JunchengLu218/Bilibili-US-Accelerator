# Bilibili US Accelerator for Loon

面向纽约及北美网络环境的 Bilibili 官方 iOS/iPadOS App CDN 测速与选择插件，兼容 Loon `3.5.0(969)`。

仓库同时发布两个版本：

| 版本 | 插件文件 | 工作方式 | 图标 |
| --- | --- | --- | --- |
| 稳定版 `0.1.8` | [`Bilibili-US-Accelerator.plugin`](Bilibili-US-Accelerator.plugin) | 捕获真实分片后，由用户手动测试 8 个候选 | 蓝色 |
| 实验版 `0.2.1` | [`Bilibili-US-Auto-Accelerator.plugin`](Bilibili-US-Auto-Accelerator.plugin) | 没有有效缓存时，自动测试 8 个候选并改写当前请求 | 黑粉色 |

> [!IMPORTANT]
> 两个插件会匹配同一批 Bilibili 视频请求，**只能启用其中一个**。同时启用会造成重复捕获、重复测速或无法判断是哪一个插件完成了改写。

## 安装

### 稳定版：8 候选手动测速

[在 Loon 中安装稳定版](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fgithub.com%2FJunchengLu218%2FBilibili-US-Accelerator%2Freleases%2Flatest%2Fdownload%2FBilibili-US-Accelerator.plugin)

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Accelerator.plugin
```

### 实验版：8 候选自动测速

[在 Loon 中安装实验版](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fgithub.com%2FJunchengLu218%2FBilibili-US-Accelerator%2Freleases%2Flatest%2Fdownload%2FBilibili-US-Auto-Accelerator.plugin)

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Auto-Accelerator.plugin
```

GitHub Release 中的插件会固定引用对应版本 tag 下的 JavaScript 和图标，便于复现。直接使用下面的 Raw URL 则会始终跟随 `main` 分支，适合参与测试，不适合需要固定版本的设备：

```text
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/Bilibili-US-Accelerator.plugin
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/Bilibili-US-Auto-Accelerator.plugin
```

## 共同前置设置

- Loon 代理模式：`TUN Only`
- Loon 流量模式：推荐 `自动分流`
- MitM 证书：已经安装并在系统设置中完全信任
- 开启 Loon VPN 后，完全退出 Bilibili App 再重新打开
- 关闭其他会改写 Bilibili 视频 Host 的插件
- 稳定版和实验版只启用一个

如果 App 一直复用已经缓存的视频分片，可以换一个未播放的视频，或完全退出 App 后重新测试。

## 稳定版怎么使用

稳定版不会让第一条播放请求等待测速，适合优先保证起播稳定性的用户。

1. 播放一个视频，让插件捕获当前真实分片；
2. 打开 Loon 的“仪表 → 所有节点”；
3. 在当前设备上，长按用于承载 Generic 菜单的 **HTTP 测试节点**；
4. 点击“Bilibili CDN 测速并应用”；
5. 等待结果页显示排名、已选择主机、缓存网络和设置指纹；
6. 回到 Bilibili，重新播放或等待下一条分片请求，后续请求会使用缓存结果。

HTTP 测试节点只是打开脚本菜单的入口，**不要把它选为全局出口节点**。测速流量由下面的 `Route` 参数决定。

## 实验版怎么使用

实验版固定使用 `first-request` 自动模式：

1. 当前网络没有有效结果时，第一条符合条件的视频请求会先保存安全快照；
2. 脚本按顺序测试 8 个候选；
3. 只有通过 `206`、`Content-Range` 和二进制长度检查的候选才能进入排名；
4. 成功后立即把当前请求改写到最快兼容候选；
5. 后续请求在缓存有效期内直接使用结果。

如果所有候选失败、脚本超时、缓存无法保存或 URL 无法安全改写，当前请求会原路放行。并发到达的其他分片不会重复启动测速。自动失败后还有 5 分钟冷却，避免每个分片都重新测试。

实验版仍保留节点菜单中的“Bilibili CDN 测速并应用”，用于已经捕获样本后的手动重测或排错；这不会把实验版改成稳定版的日常工作方式。

## 默认 8 个候选

3 个带 `ov` 的海外镜像：

```text
upos-sz-mirrorcosov.bilivideo.com
upos-sz-mirroraliov.bilivideo.com
upos-sz-mirrorhwov.bilivideo.com
```

5 个常规节点：

```text
upos-sz-mirrorali.bilivideo.com
upos-tf-all-hw.bilivideo.com
upos-sz-mirrorhw.bilivideo.com
upos-sz-mirrorcos.bilivideo.com
upos-tf-all-tx.bilivideo.com
```

候选顺序只是串行测试顺序，不是固定优先级。候选会使用真实视频的签名路径，因此脚本只接受允许的普通 Bilibili UPOS/HK 主机，并拒绝外部域名、IP、BStar、Akamai、MCDN 和代理主机。

## 所有可配置选项

稳定版和实验版使用相同的安全分类与测速参数，只有 `Mode` 被各自固定。

| 选项 | 可选值或格式 | 默认值 | 功能与注意事项 |
| --- | --- | --- | --- |
| `Mode` 测速模式 | 稳定版仅 `manual`；实验版仅 `first-request` | 由版本固定 | `manual` 只捕获并立即放行普通请求，之后由用户运行节点菜单；`first-request` 会让无缓存时的第一条请求等待自动测速。 |
| `Candidates` 候选 CDN | 逗号分隔的 Host 列表 | 上述 8 个 | 可以删减或调整测试顺序。只接受普通 `bilivideo.com` UPOS/HK 主机；重复项会去重，非法项会忽略；如果全部非法则恢复内置 8 候选。不要填写协议、路径、IP 或外部域名。 |
| `BStarAsStandard` | 开 / 关 | 关 | 关闭时 BStar 请求原路放行；开启后使用同一候选池测速，但结果存入独立的 `standard-bstar` 缓存，不会直接复用普通 UPOS 结论。非标准端口仍会安全放行。 |
| `PCDNStrategy` | `best-upos` / `xy-usource` / `passthrough` | `best-upos` | `best-upos` 把 PCDN 作为独立类型捕获并用 8 候选测速；`xy-usource` 只在 URL 中存在合法 Bilibili 来源主机时改回该来源；`passthrough` 完全不处理 PCDN。 |
| `MCDNStrategy` | `proxy-all` / `proxy-upgcxcode` / `best-upos` / `passthrough` | `proxy-all` | `proxy-all` 将匹配到的 MCDN 请求包装到内置 MCDN 代理；`proxy-upgcxcode` 只包装 `/upgcxcode/`；`best-upos` 使用独立 MCDN 样本和缓存测试普通候选；`passthrough` 原路放行。 |
| `RewriteAkamai` | 开 / 关 | 关 | 关闭时 Akamai 原路放行；开启后才会用独立 Akamai 样本测试普通候选。Akamai 签名兼容性并不保证，建议保持关闭，除非正在有意识地测试。 |
| `LiveStrategy` | 当前仅 `passthrough` | `passthrough` | 直播始终原路放行，不会进入点播候选池。该字段保留给未来经过实机验证的直播策略。 |
| `ProbeBytes` 单候选测试字节数 | `524288` / `1048576` / `2097152` | `524288`（512 KiB） | Range 越大，持续吞吐排名通常越稳定，但会增加流量、内存和首请求等待。自动版首次测试建议 512 KiB。 |
| `TimeoutMs` 单候选超时 | `2000` / `3000` / `5000` | `2000` ms | 每一次候选请求允许等待的最长时间。较短更快淘汰不可达节点，较长更能容忍高延迟网络。 |
| `Rounds` 测试轮数 | `1` / `2` / `3` | `1` | 多轮使用中位数排名，并要求至少多数轮成功。稳定性更高，但总流量和总时间近似按轮数倍增。 |
| `CacheMinutes` 结果缓存 | `15` / `60` / `360` | `15` 分钟 | 控制同一网络、请求类型和设置下最快结果的有效期。未知网络环境的缓存无论这里如何设置都最多保留 15 分钟。 |
| `Route` 测速路由 | `follow-rule`、`DIRECT` 或已有 Loon 节点/策略名 | `follow-rule` | 只控制 Probe 请求如何出站，不改变正常视频分流。`follow-rule` 跟随当前规则；`DIRECT` 让 Probe 直连；填写名称前要确认该策略确实可联网。 |
| `LogLevel` 日志级别 | `WARN` / `INFO` / `DEBUG` | `WARN` | `WARN` 只记录警告；`INFO` 适合确认分类、缓存和改写；`DEBUG` 信息最多，适合排错。日志不会主动记录 Cookie，测试截图前仍应检查是否包含签名 URL。 |

修改候选池、Range、轮数、路由或与当前请求类型相关的策略后，设置指纹会变化，旧结果不会被误当成当前配置的有效缓存。

## 流量和时间估算

额外测速流量近似为：

```text
候选数 × ProbeBytes × Rounds
```

- 推荐首次测试：`8 × 512 KiB × 1`，约 4 MiB；
- 最大设置：`8 × 2 MiB × 3`，约 48 MiB；
- 最大超时组合：`8 × 5 秒 × 3`，理论等待约 120 秒，加上脚本收尾仍低于插件的 180 秒总超时。

最大设置适合有意识的手动对比，不建议用于实验版第一次自动起播。

## 如何确认改写成功

测速结果页或通知会显示排名和“已选择”主机。随后在 Loon 请求记录中检查：

- 请求仍保留原路径、查询参数和 Range；
- Host 变为本轮“已选择”的候选；
- 日志出现 `Cache lookup status=valid` 和 `Apply cached host ...`；
- 测速请求带有内部 Probe 标记，不会递归触发脚本；
- Akamai、BStar、直播等默认放行类型不应被普通 UPOS 结果误改写。

Node.js 测试只能证明脚本逻辑，不能替代 iPhone/iPad 上对 Loon 生命周期、MitM、真实签名兼容性和具体网络速度的验证。

## 原理与进阶

- [自动/手动测速 8 候选测试说明](docs/loon-auto-cdn-auto-manual-8-test.zh-CN.md)
- [自动 CDN 测速与选择：设计、算法、边界和测试方案](docs/loon-auto-cdn-benchmark-design.zh-CN.md)
- [初版实现逐段详解](docs/loon-auto-cdn-initial-implementation.zh-CN.md)
- [BiliUniverse/Redirect 的原理、安装、验证与局限](docs/biliuniverse-redirect-loon-guide.zh-CN.md)
- [realzza/bilibili-accelerator 实现分析](docs/realzza-bilibili-accelerator-analysis.zh-CN.md)

## 开发和发布

```text
.
├── Bilibili-US-Accelerator.plugin       # 稳定手动版
├── Bilibili-US-Auto-Accelerator.plugin  # 实验自动版
├── assets/                              # 发布图标、备用图标和源文件
├── docs/                                # 设计、使用和排错文档
├── scripts/                             # Loon 脚本及验证/发布工具
└── test/                                # Node.js 自动化测试
```

运行两套验证：

```bash
bash scripts/validate.sh
bash scripts/validate-auto.sh
```

生成指向测试分支的自动版插件：

```bash
bash scripts/prepare-auto-test-plugin.sh <test-branch>
```

生成固定引用某个版本 tag 的 Release 资产：

```bash
bash scripts/prepare-release-assets.sh v0.1.8
```

推送与稳定版 `#!version` 一致的 `v*` tag 后，GitHub Actions 会再次验证两个插件，并把稳定版和实验版同时附加到同一个 GitHub Release。

## 图标资源维护

[`assets/bilibili-blue.png`](assets/bilibili-blue.png) 是稳定版图标；[`assets/variants/bilibili-black-pink.png`](assets/variants/bilibili-black-pink.png) 是实验版图标。两者都已去除完全透明的外围边框，以免在 Loon 中显得偏小。

```text
assets/
├── bilibili-blue.png
├── variants/
│   ├── bilibili-black-pink.png
│   ├── bilibili-pink.png
│   ├── bilibili-pink-smile.png
│   └── bilibili-pink-wordmark.png
└── source/
    ├── icns/
    └── exported-png/
```

| 成品图标 | 画布尺寸 | 用途 |
| --- | ---: | --- |
| `bilibili-blue.png` | 872 × 872 | 稳定版正式图标 |
| `bilibili-black-pink.png` | 824 × 824 | 实验版正式图标 |
| `bilibili-pink.png` | 872 × 872 | 备用粉色版本 |
| `bilibili-pink-smile.png` | 872 × 872 | 备用微笑电视版本 |
| `bilibili-pink-wordmark.png` | 844 × 844 | 备用文字标志版本 |

`assets/source/icns/` 保存原始 ICNS，`assets/source/exported-png/` 保存未裁剪的多分辨率 PNG。插件不应直接引用 `source/` 文件，因为透明安全区会让图标显示偏小。正式图标的公开路径应保持稳定；新增文件使用小写 kebab-case 名称并保留 PNG 透明通道。

图标由仓库维护者收集和整理，目前尚未记录每个文件的原始下载页面和单独许可。用于本仓库以外的再分发前，应先核实并补充来源和许可条款。Bilibili 名称、标志及相关商标属于其权利人；本项目不隶属于 Bilibili，也未获得其背书，MIT 许可证不授予第三方商标或图标权利。

## 更新

两个 Release 下载 URL 都保持不变。发布新版本后，可以在 Loon 中开启资源自动更新、点击插件更新按钮，或打开[更新所有 Loon 订阅资源](https://www.nsloon.com/openloon/update?sub=all)。更新完成后在插件详情中核对 `#!version`。

## 致谢

问题定位参考了 [BiliUniverse/Redirect issue #10](https://github.com/BiliUniverse/Redirect/issues/10) 和 [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 的 CDN 分类思路。

## 免责声明

本项目是个人网络兼容性配置，与哔哩哔哩、Loon 或上述开源项目均无隶属关系。请遵守当地法律、平台条款和内容授权规则。
