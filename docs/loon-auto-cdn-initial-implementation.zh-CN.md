# Bilibili US Auto Accelerator 初版源码详解

> 对应版本：`Bilibili-US-Auto-Accelerator.plugin` 0.1.1
> 对应脚本：`scripts/bilibili-auto-cdn.js`  
> 读者：第一次接触 Loon 插件或 JavaScript 的用户  
> 状态：本地逻辑测试通过，仍需 iPhone/iPad 与目标 Loon 版本实机验证

## 一、这个初版已经做了什么

这个初版实现了设计文档中风险较低的“捕获后手动测速”流程：

1. 哔哩哔哩 App 发出视频或音频分片请求；
2. Loon 在请求发出前运行本项目脚本；
3. 脚本先把请求分成普通 UPOS、PCDN、MCDN、BStar、Akamai、直播或未知；
4. 普通 UPOS 没有有效测速结果时，只保存一条 5 分钟有效的真实分片样本，原请求立即放行；
5. 用户在 Loon 中手动运行“Bilibili CDN 测速并应用”；
6. 脚本用同一条路径、签名和 Range 串行测试四个候选；
7. 只有通过 `206 + Content-Range + 二进制长度` 检查的候选才能参加排名；
8. 结果按 Wi-Fi 和流量 profile 分开保存；
9. App 的下一条同类分片请求才会改写到已验证的最佳 Host；
10. 捕获、测速、读取存储或改写任何一步失败，原请求都保持不变。

它不是“安装后马上自动阻塞第一条请求测速”的版本。这样做是有意的：初版先保证不因为四个串行 Probe 延迟首帧，也避免在尚未实机确认 Loon 生命周期之前承诺全自动体验。

## 二、文件地图

| 文件 | 作用 | 适合先看什么 |
| --- | --- | --- |
| `Bilibili-US-Auto-Accelerator.plugin` | Loon 插件入口、参数、匹配规则和 MitM 范围 | `[Argument]`、`[Script]`、`[MITM]` |
| `scripts/bilibili-auto-cdn.js` | 分类、捕获、测速、验证、缓存和改写的全部实现 | `handleRequest()` 与 `runManualBenchmark()` |
| `test/bilibili-auto-cdn.test.js` | 不依赖 Loon 的纯逻辑测试 | 每个 `test(...)` 都是一条安全要求 |
| `scripts/validate-auto.sh` | 一次运行语法、插件结构和单元测试 | 发布或提交前执行 |
| `scripts/prepare-auto-test-plugin.sh` | 生成指向 GitHub 测试分支的临时插件 | 准备 iPhone/iPad 实机测试时执行 |
| `docs/loon-auto-cdn-benchmark-design.zh-CN.md` | 完整设计、边界、后续阶段和实机验收标准 | 想知道“为什么这样设计”时阅读 |

本详解中的行号最初对应 0.1.0；0.1.1 补齐了 generic 手动入口的图标和显式启用参数。以后增加代码时行号可能移动，函数名会比行号更稳定。

## 三、先认识五个 Loon 对象

脚本中以 `$` 开头的名称由 Loon 提供，不是本项目自己创造的。

### 1. `$request`

它表示 App 正准备发出的请求。初版主要读取：

- `$request.url`：完整视频分片地址；
- `$request.method`：只处理 `GET`；
- `$request.headers`：从中读取 Range，并在安全改写时更新 Host。

### 2. `$argument`

它保存用户在插件参数页面中的选择。插件在 `Bilibili-US-Auto-Accelerator.plugin:12-26` 声明参数，再在每条脚本入口通过 `argument=[{...}]` 传给 JavaScript。

脚本的 `parseSettings()` 位于 `scripts/bilibili-auto-cdn.js:128`。它不会盲目信任参数，而会再次限制枚举、数字大小、候选域名和路由字符串。

### 3. `$persistentStore`

它是 Loon 给脚本使用的字符串存储。初版先用 `JSON.stringify()` 把对象变成字符串，再保存：

- 最近捕获的真实分片；
- 测速结果和完整排名；
- 防止重复测速的临时锁。

脚本没有调用 `$persistentStore.remove()`，因为 Loon 文档说明它会清除脚本 API 保存的全部数据。只想让一条 capture 或 lock 失效时，脚本会覆写一个 `expiresAt: 0` 的小对象。

### 4. `$httpClient`

手动测速时，脚本通过 `$httpClient.get()` 主动请求候选 CDN。每次只请求一个固定 Range，而且四个候选串行运行，不会同时抢当前网络的带宽。

### 5. `$done()`

它告诉 Loon：“脚本结束，可以继续处理请求或释放资源。”

- `$done({})`：原请求不修改；
- `$done({ url, headers })`：把请求改成新 URL 和 Header；
- generic 手动脚本使用 `$done()`：只表示脚本运行结束。

初版用 `finish()` 包装 `$done()`，防止异常路径重复调用。

## 四、插件文件逐段解释

### 1. 元数据

位置：`Bilibili-US-Auto-Accelerator.plugin:1-10`

插件名称带有 `Experimental`，版本是 `0.1.1`，最低 Loon 版本是当前 App Store 版本 `3.5.0(969)`。它与稳定版 `Bilibili-US-Accelerator.plugin` 是两个独立插件，安装实验版时应先关闭稳定版和其他 CDN 改写插件，避免同一请求被改写两次。

本初版使用的 Loon 能力都早于 Build 969：

| 能力 | 官方文档标注的最低 Build |
| --- | ---: |
| 插件 `[Argument]` 参数界面 | 733 |
| `$httpClient` 二进制 Body | 基础网络请求能力；当前文档支持 |
| `auto-redirect=false` | 660 |
| `auto-cookie=false` | 662 |
| `alpn=h2` | 715 |
| `normal` 插件类型 | 3.5.0(969) 明确支持 |

因此改为 3.5.0 不需要降低测速或安全验证功能。仍需实机确认的是 Bilibili 请求形态、MitM 通配和 CDN 兼容性，而不是这些 API 是否晚于 Build 969。

### 2. 参数

位置：`Bilibili-US-Auto-Accelerator.plugin:12-26`

| 参数 | 默认值 | 初版含义 |
| --- | --- | --- |
| `Mode` | `manual` | 初版只有手动测速，不阻塞第一次播放 |
| `Candidates` | AliOV、TF-HW、TF-TX、Ali | 普通候选池；非法、BStar、Akamai、MCDN、IP 和任意外部 Host 会被拒绝 |
| `BStarAsStandard` | `false` | 关闭时 BStar 原样放行；开启时用独立 `standard-bstar` 缓存测速 |
| `PCDNStrategy` | `best-upos` | 保存规范化样本，手动测速成功后才改到普通候选 |
| `MCDNStrategy` | `proxy-all` | 默认把完整 MCDN URL 编码给 `proxy-tf-all-ws`；也可选只代理 upgcxcode、实测 best-upos 或放行 |
| `RewriteAkamai` | `false` | 默认放行；开启后用独立 `akamai` profile 测试兼容性 |
| `LiveStrategy` | `passthrough` | 初版直播永远原样放行 |
| `ProbeBytes` | `1 MiB` | 每个候选每轮最多请求的目标大小 |
| `TimeoutMs` | `3000 ms` | 每个候选的 `$httpClient` 超时 |
| `Rounds` | `1` | 可改为 2 或 3，多轮使用成功结果的中位数 |
| `CacheMinutes` | `60` | Wi-Fi 下结果有效期；未知网络最长仍只有 15 分钟 |
| `Route` | `follow-rule` | Probe 跟正常 Loon 分流；也可指定 `DIRECT` 或策略名 |
| `LogLevel` | `WARN` | 默认不打印每个 Probe；调试时可改为 INFO/DEBUG |

四候选、1 MiB、一轮大约会产生 4 MiB 额外流量。三轮约 12 MiB，不建议在计费蜂窝网络上随意运行。

### 3. `[General]`

位置：`Bilibili-US-Auto-Accelerator.plugin:28-30`

`force-http-engine-hosts` 让 4480、4483、8000、8082、9102 这些常见非标准端口进入 Loon HTTP 引擎。它不表示所有这些地址都一定是 PCDN；最终仍由脚本分类。

### 4. `[Script]`

位置：`Bilibili-US-Auto-Accelerator.plugin:32-41`

插件提供五条 `http-request` 入口：

1. PCDN `:4480/upgcxcode/`；
2. MCDN；
3. Akamai/BStar Akamai；
4. 直播 `/live-bvc/`；
5. 普通 UPOS/HK `/upgcxcode/`。

它们全部加载同一个 `scripts/bilibili-auto-cdn.js`。入口正则只负责尽量收窄触发范围，脚本内部的 `classifyRequest()` 仍会重新分类。这样不能把安全边界寄托在插件规则顺序上。

最后一条 `generic` 是用户手动运行的测速入口，超时设为 120 秒。0.1.2 为它显式添加 `img-url=speedometer.system` 和 `enable=true`，使它能注册为 Loon 节点长按菜单里的可见操作。`.system` 后缀表示使用系统 SF Symbol；不带后缀时 Loon 可能把值当成无效图片地址。按默认四候选、一轮、3 秒单项超时，理论最坏网络等待约 12 秒；三轮、5 秒单项超时最坏约 60 秒。

### 5. `[MITM]`

位置：`Bilibili-US-Auto-Accelerator.plugin:43-45`

要根据 HTTPS 的路径 `/upgcxcode/` 运行请求脚本，Loon 通常需要解密目标主机。初版只列出明确的 Bilibili 视频主机族，没有使用覆盖所有互联网或整个 Bilibili API 的宽泛规则。

MitM 证书必须由用户自己安装并信任。不要把包含完整查询参数的请求日志、HAR 或截图公开上传，因为视频 URL 可能带有短期签名。

## 五、JavaScript 的主流程

### 1. Loon 怎样选择入口

文件底部判断当前有哪些全局对象：

```javascript
if (typeof $request !== "undefined" && typeof $response === "undefined") {
  handleRequest(runtime, $request, settings);
} else if (typeof $request === "undefined" && typeof $response === "undefined") {
  runManualBenchmark(runtime, settings);
} else {
  finish({});
}
```

含义很简单：

- 有 `$request`：这是播放请求，执行分类/捕获/缓存改写；
- 没有 `$request`、也没有 `$response`：这是用户手动运行 generic；
- 有 `$response`：初版不修改响应，直接放行。

### 2. 请求入口 `handleRequest()`

位置：`scripts/bilibili-auto-cdn.js:921`

处理顺序如下：

```text
检查 Probe Header
→ 分类
→ 直播/未知放行
→ MCDN 独立策略
→ PCDN 独立策略
→ BStar 开关
→ Akamai 开关
→ 普通 UPOS
```

自己的测速请求带 `X-Bili-CDN-Probe: 1`。如果它再次进入脚本，入口会立即 `$done({})`，从而避免 Probe 递归产生更多 Probe。

### 3. 分类器 `classifyRequest()`

位置：`scripts/bilibili-auto-cdn.js:254`

分类器使用设计文档规定的优先级：

```text
直播 → MCDN → PCDN → BStar → Akamai → 普通 UPOS → 未知
```

几个容易出错的例子：

- `xy.mcdn.bilivideo.cn:4483` 同时有 MCDN 后缀和 PCDN 风格端口，但必须先归为 MCDN；
- `upos-bstar1-mirrorakam.akamaized.net` 同时有 BStar 和 Akamai 信号，但必须由 `BStarAsStandard` 控制；
- `/live-bvc/` 即使 Host 名字像 UPOS，也绝不能进入点播 Host Swap；
- `*ov`、`tf-all-*`、普通 Ali 和 `cn-hk-eq-*` 都属于普通候选测速空间；
- 非 `GET` 请求、无法解析的 URL 和未知媒体地址原样放行。

### 4. 捕获/应用缓存 `handleBenchmarkableRequest()`

位置：`scripts/bilibili-auto-cdn.js:875`

这个函数只做三件事：

1. 检查当前 profile 是否被设置允许；
2. 有有效结果时，改到该 profile 的 `bestHost`；
3. 没有结果时，保存 5 分钟有效的 capture，然后原样放行。

它不会在请求中调用 `$httpClient`，因此初版不会让首条播放请求等待四候选测速。

## 六、为什么 Host 改写不使用普通 URL 重新编码

### 1. `parseRawUrl()`

位置：`scripts/bilibili-auto-cdn.js:166`

签名 URL 中的 `%2F`、`+`、参数顺序等细节可能参与鉴权。如果用高级 URL API 解析后重新生成，存在编码或顺序变化的风险。

初版只解析：

```text
scheme://authority + 原始 tail
```

其中 `tail` 是原始路径、查询和 fragment 的完整字符串，脚本不 decode，也不重新排列。

### 2. `replaceHostnameOnly()`

位置：`scripts/bilibili-auto-cdn.js:222`

这个函数只把 authority 中的 hostname 换成已经通过候选白名单的 Host，再把原始 `tail` 直接接回去。PCDN/MCDN 进入普通候选前可显式要求 `dropPort=true`，避免把 `:4480` 或 `:4483` 带到普通 CDN。

### 3. `rewriteToHost()`

位置：`scripts/bilibili-auto-cdn.js:335`

最终改写除了 URL，还会：

- 不区分大小写地更新已有 `Host`；
- 只在原请求已经有 `:authority` 时更新它；
- 保留 Range 和其他 App Header。

普通、BStar 和 Akamai 若带与协议不匹配的非默认端口，会安全放行，不会把奇怪端口复制给候选。

## 七、候选白名单怎样防止签名泄露

位置：

- `validateCandidateHost()`：`scripts/bilibili-auto-cdn.js:96`
- `parseSettings()`：`scripts/bilibili-auto-cdn.js:128`

允许的候选必须满足：

```text
(upos-... 或 cn-hk-eq-...).bilivideo.com
```

并额外拒绝：

- BStar；
- Akamai；
- MCDN；
- `proxy-tf-all-ws`；
- IP；
- 带协议、路径、查询或端口的输入；
- 任意外部域名。

原因不是“格式好看”，而是 Probe 会把原视频的完整签名路径发给候选。若允许任意 Host，恶意服务器就能收到该 URL。

如果用户填写的候选全部非法，脚本不会使用这些输入，而是回到内置四候选。重复的合法 Host 会静默去重。

## 八、Range 怎样生成和验证

### 1. `buildFixedProbeRange()`

位置：`scripts/bilibili-auto-cdn.js:355`

例子：

```text
App 原 Range:   bytes=8388608-
ProbeBytes:     1048576
实际 Probe:     bytes=8388608-9437183
```

如果 App 没有 Range，从 `bytes=0-...` 开始。如果是后缀 Range、多区间 Range 或无法解析的格式，脚本不猜测，直接放弃捕获/测速。

### 2. `validateProbe()`

位置：`scripts/bilibili-auto-cdn.js:394`

候选要进入排名，必须同时通过：

1. `$httpClient` 没有 error；
2. 状态码严格等于 `206`；
3. `Content-Range` 存在；
4. 返回起点等于请求起点；
5. 返回终点不超过请求终点；
6. Body 真的是 `Uint8Array` 或 `ArrayBuffer`；
7. Body 长度等于 Content-Range 声明的长度；
8. Body 至少达到目标大小的 90%，且不能异常超大；
9. Content-Type 没有明确显示 HTML、JSON 或 XML 错误页。

`200` 会被判失败，因为它可能表示服务器忽略 Range，准备返回完整视频。Loon 没有公开的流式中途取消 API，不能冒这个内存和流量风险。

## 九、手动测速怎样串行工作

### 1. `runManualBenchmark()`

位置：`scripts/bilibili-auto-cdn.js:992`

generic 入口会：

1. 查找当前网络下最新且未超过 5 分钟的 capture；
2. 检查当前参数仍允许该 profile；
3. 获取一个尽力而为的测速锁；
4. 调用 `benchmarkSerially()`；
5. 选择最佳兼容候选；
6. 保存结果并让 capture 过期；
7. 用通知展示安全排名，不显示完整 URL。

### 2. `benchmarkSerially()`

位置：`scripts/bilibili-auto-cdn.js:763`

它先建立任务列表：

```text
第 1 轮：候选 1 → 候选 2 → 候选 3 → 候选 4
第 2 轮：候选 1 → 候选 2 → 候选 3 → 候选 4
...
```

每个 `$httpClient.get()` 的回调结束后才运行下一项，因此不会并发测速。请求参数包括：

```javascript
{
  timeout: settings.timeoutMs,
  headers: {
    Range: rangeInfo.header,
    Accept: "*/*",
    "X-Bili-CDN-Probe": "1"
  },
  "binary-mode": true,
  "auto-cookie": false,
  "auto-redirect": false,
  alpn: "h2"
}
```

脚本只从原请求保存 `User-Agent`、`Referer` 和 `Origin` 三种可选 Header，不保存 Cookie、Authorization、设备标识或全部 Header。

### 3. 排名

位置：

- `aggregateRanking()`：`scripts/bilibili-auto-cdn.js:435`
- `chooseBest()`：`scripts/bilibili-auto-cdn.js:470`

一轮时按有效 Mbps 排序。多轮时：

- 至少成功 `ceil(轮数 / 2)` 才算兼容；
- 速度、字节数和耗时各取成功轮次的中位数；
- 最快与当前来源差距小于 5% 时，如果当前来源本来就是候选，优先保持当前来源，减少没有意义的切换。

有效速度公式是：

```text
返回字节数 × 8 ÷ 总毫秒数 ÷ 1000
```

它包含 DNS、TCP、TLS、等待和下载，不是纯链路吞吐量。

## 十、缓存为什么不会跨类别误用

### 1. profile

初版使用五个独立 profile：

| profile | 对应来源 |
| --- | --- |
| `standard-upos` | 普通 UPOS、OV、TF、HK |
| `standard-bstar` | 仅开启 BStar 开关后 |
| `pcdn` | PCDN `best-upos` |
| `mcdn` | MCDN `best-upos` |
| `akamai` | 仅开启 Akamai 开关后 |

即使五个 profile 最终都选到同一个 Host，它们也不会读取彼此的结果。BStar 或 Akamai 必须用自己的真实签名样本证明兼容，不能因为普通视频成功就直接套用。

### 2. network key

有 SSID 时：

```text
wifi:<ssid>
```

无法取得 SSID 时：

```text
network:unknown
```

未知网络可能在 Wi-Fi 和蜂窝之间复用，所以不论用户选择 60 分钟还是 360 分钟，它的结果最长只保存 15 分钟。

### 3. settings fingerprint

位置：`settingsFingerprint()`，`scripts/bilibili-auto-cdn.js:499`

候选池、Probe 大小、轮数、Route、profile 或特殊策略发生变化时，旧结果会因 fingerprint 不同而失效。`readValidResult()` 位于 `scripts/bilibili-auto-cdn.js:536`，还会检查 schema、网络、profile、过期时间和 bestHost 白名单。

## 十一、特殊流量各自怎样处理

### 1. BStar

- 默认：原样放行，不捕获；
- 开启 `BStarAsStandard`：共用候选池和算法，但写入 `standard-bstar`；
- 直接 Host Swap 只接受正常 HTTP/HTTPS 端口；
- Probe 全失败：保留原 BStar URL。

### 2. PCDN

`best-upos`：

- 去掉 PCDN 非标准端口；
- 保留原路径和查询；
- 保存为 `pcdn` capture；
- 只有手动 Probe 成功后，后续请求才使用普通候选。

`xy-usource`：

- 读取并最多解码两次 `xy_usource`；
- 只接受普通 Bilibili 候选白名单 Host；
- 完整 URL 还必须使用 HTTP/HTTPS 和默认端口；
- 非法、缺失或外部来源全部放行。

`passthrough`：完全不改。

初版插件入口能直接捕获 `http://任意主机:4480/upgcxcode/`，但还不能保证覆盖所有未来 PCDN 第三方域名或标准端口地址。需要根据实机观察补充并收窄规则。

### 3. MCDN

位置：`wrapMcdnProxyOnce()`，`scripts/bilibili-auto-cdn.js:697`

`proxy-all` 把完整原地址包装成：

```text
http://proxy-tf-all-ws.bilivideo.com/?url=<完整原 URL 的编码值>
```

这不是普通 Host Swap。函数会检测已经包装的 URL，避免重复套娃。

`proxy-upgcxcode` 只包装 `/upgcxcode/`，让 `/v1/resource/` 原样继续。

`best-upos` 使用独立 `mcdn` capture；只有普通候选对该对象返回正确 `206` 后才应用。

`passthrough` 完全不改。

`proxy-tf-all-ws` 的实际稳定性和隐私边界仍需用户所在网络实测；不希望使用代理包装时应选择 `passthrough` 或谨慎测试 `best-upos`。

### 4. Akamai

- 默认关闭，原样放行；
- 开启后写入独立 `akamai` capture/result；
- Akamai Host 永远不会进入候选池；
- 所有普通候选返回 403 或其他失败时，仍保留原 Akamai URL。

### 5. 直播

初版只识别并放行 `/live-bvc/`，不会调用点播 Host Swap。插件没有加入 `http-response` 入口，因为直播播放信息接口和 `url_info` 结构还没有在目标 App/Loon 版本实机确认。

## 十二、怎样安装和使用初版

### 安装前

1. 关闭稳定版 `Bilibili US Accelerator`；
2. 关闭 `BiliUniverse Redirect` 或其他会改写同一 Bilibili 视频请求的插件；
3. 确认 Loon MitM 证书已经安装、完全信任且 MitM 功能开启；
4. 先使用默认参数，不要一开始就打开 BStar/Akamai 或三轮测速。

### 方案 A：已经合并到 main 后安装

当本初版已推送到 GitHub `main` 后，可以在 Loon 插件页面添加：

```text
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/main/Bilibili-US-Auto-Accelerator.plugin
```

在代码尚未推送到 GitHub 前，这个远程地址仍会指向旧的远端状态，不能代表本地工作区中的新文件。

### 方案 B：从临时 GitHub 分支部署测试版（推荐）

手机上的 Loon 不能直接读取 Mac 工作区文件。最稳妥的测试方法是把代码推到临时公开分支，并生成一个所有 `script-path` 都指向该分支的测试插件。

以下命令不会使用宽泛的 `git add .`，避免顺手提交工作区中其他未完成的文档：

```bash
cd /Users/junchenglu/Documents/Github/Bilibili-US-Accelerator

# 本地 origin 仍是旧仓库名时，先改成当前规范地址。
git remote set-url origin https://github.com/JunchengLu218/Bilibili-US-Accelerator.git
git remote get-url origin

git switch -c codex/loon-3.5.0-test

bash scripts/prepare-auto-test-plugin.sh codex/loon-3.5.0-test

git add \
  Bilibili-US-Auto-Accelerator.plugin \
  Bilibili-US-Auto-Accelerator.test.plugin \
  scripts/bilibili-auto-cdn.js \
  scripts/prepare-auto-test-plugin.sh \
  scripts/validate-auto.sh \
  test/bilibili-auto-cdn.test.js \
  docs/loon-auto-cdn-initial-implementation.zh-CN.md

git commit -m "Add experimental Loon 3.5.0 auto CDN plugin"
git push -u origin codex/loon-3.5.0-test
```

生成脚本会输出要添加到 Loon 的 URL，默认是：

```text
https://raw.githubusercontent.com/JunchengLu218/Bilibili-US-Accelerator/codex/loon-3.5.0-test/Bilibili-US-Auto-Accelerator.test.plugin
```

规范仓库名固定为 `JunchengLu218/Bilibili-US-Accelerator`。本地 `origin` 如果仍显示旧仓库名，不会影响测试插件生成器；在 fork 中测试时可通过 `GITHUB_REPOSITORY=owner/repo` 显式覆盖。

测试插件中的六个 JavaScript 地址也会指向同一测试分支，并附带新的 cache-buster。这样不会出现“插件来自测试分支，脚本却仍然下载 main 旧代码”的情况。

如果仓库是私有仓库，Loon 无法自动携带 GitHub 登录凭证读取 raw URL。应使用公开测试仓库/分支，或者把这两个文件发布到另一个可直接访问的 HTTPS 地址。

### 在 Loon 3.5.0 中添加测试插件

1. 打开 Loon 的插件页面；
2. 添加远程插件，粘贴生成脚本输出的 raw URL；
3. 确认插件详情显示最低版本 `3.5.0(969)`；
4. 打开参数页，先保留默认值；
5. 启用实验插件，同时关闭稳定版和 BiliUniverse Redirect；
6. 手动更新一次插件资源；
7. 如果刚刚重新生成过测试插件，先删除旧测试资源再添加新 URL，最容易避开缓存干扰；
8. 确认 MitM 证书已经安装、信任并启用。

### 第一次测速

1. 安装并启用实验插件；
2. 完全退出哔哩哔哩 App；
3. 重新打开一个点播视频；
4. 拖到一个未缓存的位置，产生新的 Range 请求；
5. 在 5 分钟内回到 Loon；
6. 打开 `仪表 -> 所有节点`，长按任意一个节点；入口修复后，没有代理订阅时，自己建立的纯直连节点也只用来打开这个菜单；
7. 在弹出的测速操作中点 `Bilibili CDN 测速并应用`；
8. 等待通知显示兼容候选和排名；
9. 回到 App，重新打开视频或再次拖到未缓存位置；
10. 在 Loon 请求详情中确认新的大流量请求 Host 等于通知中的 `已选择`。

如果通知说“暂无可测速样本”，常见原因是：

- 没有产生符合规则的新分片；
- capture 已超过 5 分钟；
- 视频走了初版入口尚未覆盖的 PCDN/直播/QUIC 地址；
- MitM 没有生效；
- 同时启用了另一个改写插件。

## 十三、怎样验证代码

仓库没有要求全局安装 npm 包。只需要可用的 Node：

```bash
NODE_BIN=/path/to/node bash scripts/validate-auto.sh
```

若 `node` 已经在 PATH 中，也可以直接：

```bash
bash scripts/validate-auto.sh
```

校验脚本会检查：

- 插件和脚本文件存在；
- 插件版本、类型、五条分类入口和 generic 入口存在；
- 实验版没有退回宽泛的静态 Rewrite；
- JavaScript 语法正确；
- 全部纯逻辑单元测试通过。

单元测试覆盖：

- 原始路径/查询字符串不变；
- Host 和 `:authority` 大小写处理；
- Range 构造和非法 Range 拒绝；
- `206`、Content-Range、Body 类型/长度校验；
- 分类优先级；
- BStar/Akamai/profile 隔离；
- PCDN 规范化与 `xy_usource` 白名单；
- MCDN 只包装一次；
- 网络键、TTL、锁和候选 fingerprint；
- `$httpClient` 的串行任务数量与安全参数。

这些测试不能代替实机测试。Node 测试证明的是本项目纯逻辑按预期工作，不证明某个 CDN 此刻在用户网络可用，也不证明目标 Loon 构建对所有 MitM 通配和二进制 Body 的行为完全一致。

## 十四、初版有意没有实现什么

以下功能仍按设计文档留在后续阶段：

- 首次请求自动阻塞测速；
- 蜂窝网络自动测速开关；
- `http-response` 成功/失败反馈；
- 候选临时拉黑与自动切换第二名；
- 直播播放信息 `url_info` 过滤；
- 对所有 PCDN 第三方域名、纯 IP 标准端口和未来地址形态的入口覆盖；
- QUIC/HTTP/3 捕获策略；
- 一键清除全部项目缓存；
- 对内容一致性做字节摘要比较；
- 官方 App 的缓冲、首帧和卡顿事件闭环。

因此 0.1.1 应继续标为 Experimental。公开发布前至少应按设计文档“二十、测试方案”完成普通、PCDN、MCDN、Akamai、BStar、直播和不同网络的实机验证。

## 十五、最重要的安全结论

对小白来说，只要记住下面四条即可：

1. **测速失败不会把失败候选当最佳。** 没有候选通过严格 206 检查时，原播放路线不变。
2. **普通结果不会偷偷套给 BStar 或 Akamai。** 每类来源都有独立 profile。
3. **不要把任意域名放进 Candidates。** 脚本会拒绝，但理解原因更重要：候选会看到签名路径。
4. **实验版和稳定版不要同时开。** 两个插件同时改一条请求时，最终结果难以判断，也无法做可信 A/B 测试。
