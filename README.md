# Bilibili US Accelerator for Loon

面向纽约及北美网络环境的 Bilibili 官方 iOS/iPadOS App CDN 测速与选择插件，兼容 Loon `3.5.0(969)`。

仓库同时发布两个版本：

| 版本 | 插件文件 | 工作方式 |
| --- | --- | --- |
| 稳定版 `0.1.8` | [`Bilibili-US-Accelerator.plugin`](Bilibili-US-Accelerator.plugin) | 捕获真实分片后，由用户手动测试 8 个候选 |
| 实验版 `0.2.2` | [`Bilibili-US-Auto-Accelerator.plugin`](Bilibili-US-Auto-Accelerator.plugin) | 可在手动测速和首次请求自动测速之间切换 |

> [!IMPORTANT]
> 两个插件会匹配同一批 Bilibili 视频请求，**只能启用其中一个**。同时启用会造成重复捕获、重复测速或无法判断是哪一个插件完成了改写。

## 安装

### 稳定版：8 候选手动测速

[在 Loon 中安装稳定版](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fgithub.com%2FJunchengLu218%2FBilibili-US-Accelerator%2Freleases%2Flatest%2Fdownload%2FBilibili-US-Accelerator.plugin)

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Accelerator.plugin
```

### 实验版：8 候选手动 / 自动测速

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

实验版默认使用 `manual`，也可以在插件设置的“测速模式”中选择：

- `manual`：行为与稳定版相同。播放请求只捕获样本并立即放行，再从节点菜单手动测速。
- `first-request`：当前网络没有有效缓存时，让第一条合格请求等待自动测速；成功后立即应用本轮结果。

选择 `first-request` 后，自动流程如下：

1. 当前网络没有有效结果时，第一条符合条件的视频请求会先保存安全快照；
2. 脚本按顺序测试 8 个候选；
3. 只有通过 `206`、`Content-Range` 和二进制长度检查的候选才能进入排名；
4. 成功后立即把当前请求改写到最快兼容候选；
5. 后续请求在缓存有效期内直接使用结果。

如果所有候选失败、脚本超时、缓存无法保存或 URL 无法安全改写，当前请求会原路放行。并发到达的其他分片不会重复启动测速。自动失败后还有 5 分钟冷却，避免每个分片都重新测试。

无论当前选择哪种模式，实验版都保留节点菜单中的“Bilibili CDN 测速并应用”。在 `manual` 模式下这是正常测速入口；在 `first-request` 模式下可用于手动重测或排错。

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

稳定版和实验版使用相同的安全分类与测速参数。稳定版固定为 `manual`；实验版可以选择 `manual` 或 `first-request`。

| 选项 | 可选值或格式 | 默认值 | 功能与注意事项 |
| --- | --- | --- | --- |
| `Mode` 测速模式 | 稳定版仅 `manual`；实验版为 `manual` / `first-request` | `manual` | `manual` 只捕获并立即放行普通请求，之后由用户运行节点菜单；`first-request` 会让无缓存时的第一条请求等待自动测速。 |
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

## 更新

两个 Release 下载 URL 都保持不变。发布新版本后，可以在 Loon 中开启资源自动更新、点击插件更新按钮，或打开[更新所有 Loon 订阅资源](https://www.nsloon.com/openloon/update?sub=all)。更新完成后在插件详情中核对 `#!version`。

## 致谢

问题定位参考了 [BiliUniverse/Redirect issue #10](https://github.com/BiliUniverse/Redirect/issues/10) 和 [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator) 的 CDN 分类思路。

## 免责声明

本项目是个人网络兼容性配置，与哔哩哔哩、Loon 或上述开源项目均无隶属关系。请遵守当地法律、平台条款和内容授权规则。
