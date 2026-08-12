# Loon 8 候选手动稳定版与自动实验版说明

本文对应稳定手动版 `0.1.8` 和实验自动版 `0.2.1`。两个插件使用同一套安全分类、8 候选测速和缓存实现，但入口模式不同。

## 1. 两种测速模式

两种模式现在分别由两个发布插件固定，避免用户误切模式：

- 稳定版 `Bilibili-US-Accelerator.plugin` 固定 `manual`：先播放视频捕获真实分片，再到“仪表 → 所有节点 → 长按 HTTP 测试节点 → Bilibili CDN 测速并应用”手动测速。
- 实验版 `Bilibili-US-Auto-Accelerator.plugin` 固定 `first-request`：当前网络没有有效结果时，让第一条合格视频请求等待串行测速；成功后立即把这一条请求改到最快兼容候选。

两个插件不能同时启用。切换版本前先关闭另一个；在网络、profile 和设置指纹一致时，后续请求会读取同一套兼容缓存。

## 2. 默认 8 个候选

```text
upos-sz-mirrorcosov.bilivideo.com
upos-sz-mirroraliov.bilivideo.com
upos-sz-mirrorhwov.bilivideo.com
upos-sz-mirrorali.bilivideo.com
upos-tf-all-hw.bilivideo.com
upos-sz-mirrorhw.bilivideo.com
upos-sz-mirrorcos.bilivideo.com
upos-tf-all-tx.bilivideo.com
```

前三个带 `ov` 的主机是海外镜像，其余五个是常规节点。这里的顺序只是串行测试顺序，不代表固定优先级；最终仍按实测有效吞吐量排名。

候选必须是允许的普通 Bilibili UPOS/HK 主机。Akamai、BStar、MCDN、IP 地址和任意外部域名不能作为普通测速目标，因为 Probe 会携带真实视频的签名路径。

## 3. 自动模式实际做什么

当 `Mode=first-request` 且没有有效缓存时：

1. 分类当前视频请求，并检查该 profile 是否允许改写；
2. 保存不含 Cookie 的短期请求快照；
3. 获取当前网络和 profile 的测速锁；
4. 使用当前真实视频路径、签名和固定 Range，串行测试 8 个候选；
5. 只有返回正确 `206`、正确 `Content-Range` 和匹配二进制长度的候选才能进入排名；
6. 保存最快兼容结果；
7. 仅替换当前请求的 Host，原路径和查询参数保持不变；
8. 调用 `$done({url, headers})` 放行当前请求。

如果所有候选失败、脚本 API 不可用、结果无法保存或改写不安全，脚本调用 `$done({})`，让 Loon 使用原始请求继续播放。

## 4. 并发请求和失败冷却

视频与音频请求可能同时出现。只有第一个取得测速锁的请求会运行 Probe；其他并发请求不会排队等待，而是立即按原地址放行。

如果自动测速报错或所有候选失败，插件会为相同网络、profile 和设置记录 5 分钟冷却。冷却期间：

- 不会每个分片都重新运行整轮测速；
- 原始请求直接放行；
- 捕获样本仍会保留，可以从节点长按菜单手动重试。

## 5. 推荐测试设置

第一次真机验证建议使用：

```text
测速模式：first-request
单候选测试字节数：524288（512 KiB）
单候选超时：3000 ms 或更低
测试轮数：1
结果缓存：15 分钟
测速路由：follow-rule
日志级别：INFO
```

额外流量近似为：

```text
候选数 × 每候选 Range 大小 × 轮数
```

例如 8 候选 × 512 KiB × 1 轮约为 4 MiB。选择 2 MiB × 3 轮约为 48 MiB；如果多个候选一直等到 5 秒超时，整轮还可能接近 120 秒，不适合作为自动模式的首次测试。插件测速入口使用 180 秒超时，以覆盖最大配置的收尾开销，但这不代表推荐让首次播放等待这么久。

## 6. 安装插件

稳定版：

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Accelerator.plugin
```

实验版：

```text
https://github.com/JunchengLu218/Bilibili-US-Accelerator/releases/latest/download/Bilibili-US-Auto-Accelerator.plugin
```

开发者需要测试尚未合并的分支时，在仓库根目录运行：

```bash
bash scripts/prepare-auto-test-plugin.sh <test-branch>
```

把生成的 `Bilibili-US-Auto-Accelerator.test.plugin` 与该分支一起提交并推送后，再使用脚本输出的 Raw URL。主分支不保存这个临时生成文件，以免它长期指向已经过期的测试分支。

测试时请关闭另一个版本和其他会改写 Bilibili 视频 Host 的插件，否则请求可能先被另一条规则修改，无法判断本插件是否生效。

## 7. 自动模式验证步骤

1. 导入插件并确认版本为 `0.2.1`；
2. 确认“测速模式”显示实验版固定的 `first-request`；
3. 使用上面的推荐参数并将日志级别设为 `INFO`；
4. 开启 Loon VPN，完全退出 Bilibili App 后重新打开；
5. 播放一个未缓存视频并观察第一次起播；
6. 在 Loon 请求记录中打开对应 UPOS 请求的脚本日志。

成功时应看到类似日志：

```text
Start first-request benchmark for standard-upos
Probe 1/8: ...
Apply newly benchmarked host ... for standard-upos
```

随后会出现“Bilibili CDN 自动测速完成”通知。之后的请求应看到：

```text
Cache lookup status=valid
Apply cached host ... for standard-upos
```

如果全部失败，应看到“keep original host”或冷却日志，视频请求应继续使用原始 Host，而不是消失或无限等待。

## 8. 改用稳定手动版

如果自动模式导致第一次播放等待过久，关闭实验版并安装稳定版 `0.1.8`。稳定版不会在普通请求中发起 Probe，只捕获样本并立即放行，然后由用户从 HTTP 测试节点的长按菜单启动测速。该 HTTP 节点只用于打开菜单，不要把它选成全局出口。

## 9. 代码对应关系

- `parseSettings()`：读取 `manual` / `first-request`。
- `handleBenchmarkableRequest()`：读取缓存、保存样本，并决定手动放行还是进入自动测速。
- `runFirstRequestBenchmark()`：自动模式的锁、测速、保存、通知、改写和失败回退。
- `benchmarkSerially()`：构建固定 Range 并逐候选串行请求。
- `validateProbe()`：严格验证 `206`、`Content-Range`、内容类型和字节长度。
- `saveAutomaticCooldown()`：阻止自动失败后每个分片重复测速。
- `runManualBenchmark()`：保留原来的节点长按手动测速流程。

Node 测试会覆盖自动成功改写、全部失败原路放行、失败冷却、并发锁不重复 Probe，以及原有手动流程。
