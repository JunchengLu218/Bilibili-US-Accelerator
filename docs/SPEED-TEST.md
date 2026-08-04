# iPad / iOS 速度不稳排查（1MB+ ↔ 0KB）

在纽约及北美网络下，哔哩哔哩普通版与国际版（BStar，已下架但仍可本地安装）都可能出现播放速度忽高忽低。先用下面的对照实验确认是 **CDN 节点问题**、**改写未命中**，还是 **App/系统侧干扰**，再决定优化方向。

## 现象怎么读

| 现象 | 更可能的原因 |
| --- | --- |
| 同一视频有时 >1MB/s，有时长时间 0KB/s | 分片落到不同 CDN；或连接卡住后重试 |
| 只有部分冷门/4K 视频 0KB | 调度到劣质海外节点、MCDN/PCDN |
| 普通版卡、国际版也卡 | 两边 CDN 体系不同；当前稳定版插件主要覆盖普通版 UPOS |
| 开启插件后仍偶发 0KB | 请求未改写（Akamai/MCDN/国际版），或目标 CDN 当时也差 |
| 改写后花屏/绿屏 | 把带 Akamai 签名的分片改到了 UPOS 镜像 |

应用内显示的「加载速度」只是客户端估算，**以 Loon 请求记录里的主机名和吞吐为准**。

## 测试前准备

1. Loon：`TUN Only` + `自动分流`，MitM 证书已安装并完全信任。
2. **只启用本仓库这一份** Bilibili CDN 插件；暂时关掉其他 BiliUniverse Redirect / 同类 Rewrite。
3. 关闭 iCloud 专用代理（设置 → Apple ID → iCloud → iCloud+ → 专用代理）。
4. 完全划掉哔哩哔哩普通版 / 国际版后再打开（不要只锁屏）。
5. 准备 2～3 个固定 BV：一个热门 1080P、一个冷门、一个 4K（若有）。每次测同一清晰度。

## A/B 对照（确认问题）

对每个 BV 各测两轮，每轮播放至少 60 秒，并在卡顿时立刻看 Loon：

| 轮次 | 插件 | 要记的内容 |
| --- | --- | --- |
| A | 关闭 | 原始主机名、端口、是否出现 0KB |
| B | 开启 | 「修改后的链接」主机名、是否仍 0KB |

在 Loon → 近期请求 / 记录中筛选 `bilivideo` / `akamaized` / `mcdn`，截图时**遮住 `?` 后全部参数**。

### 主机名归类

把卡住那一刻的主机名对号入座：

| 主机名模式 | 类型 | 本仓库稳定版行为 |
| --- | --- | --- |
| `upos-*.bilivideo.com`（非 akam） | 普通 UPOS | 应改写到 `upos-sz-mirrorali.bilivideo.com` |
| `cn-hk-eq-*.bilivideo.com` | 港区节点 | 应改写到 `upos-sz-mirrorali.bilivideo.com` |
| `upos-*-mirrorakam.akamaized.net` | Akamai | **故意不改写**（避免花屏） |
| `*.mcdn.bilivideo.cn` 等 | MCDN | 改写到 `proxy-tf-all-ws.bilivideo.com` |
| `upos-bstar*-mirrorakam.akamaized.net` | 国际版 BStar | 稳定版不覆盖；需单独观察 |

判定规则：

- **A 卡在海外/随机 UPOS，B 已到 `mirrorali` 且稳定** → CDN 调度问题，插件有效。
- **A/B 都卡在 `akamaized.net`** → 不是本插件漏改 UPOS，而是 Akamai 路径差；不要为了冲速度强行改写 Akamai。
- **A/B 都出现 `mcdn` 且 B 未变成 `proxy-tf-all-ws`** → 检查 MitM、插件版本、是否有冲突规则。
- **国际版全程 `upos-bstar*-mirrorakam`** → 与普通版不是同一套 CDN；当前稳定版无法靠 UPOS 改写修好国际版。

## 普通版 vs 国际版怎么分开测

1. 同一 Wi‑Fi、同一时间段，先普通版再国际版，各播同一类内容（纪录片/动画等可公开片源）。
2. 普通版重点看：`bilivideo.com` 是否进 `mirrorali`，以及有无 `mcdn`。
3. 国际版重点看：是否几乎全是 `upos-bstar*-mirrorakam.akamaized.net`。若是，速度不稳属于 BStar/Akamai 线路问题，不是「普通版 UPOS 改写失败」。
4. 不要把「国际版也慢」直接归因于本插件；先确认请求有没有进入 Rewrite。

## 优化顺序（有数据后再动）

1. **确认改写命中**：普通 UPOS/HK → `upos-sz-mirrorali.bilivideo.com`；MCDN → `proxy-tf-all-ws.bilivideo.com`。
2. **排除冲突**：同时开多个 Redirect 时，主机名可能来回跳，表现为 1MB ↔ 0KB。
3. **换目标 CDN 做小样本**（仅普通 UPOS）：在同一批 BV 上试 `mirrorali` / `mirrorcos` / `mirrorhw`，记录平均吞吐与卡顿次数；北美常见是阿里或腾讯更稳，以你本地 A/B 为准。
4. **Akamai / BStar**：优先保持不改写。若必须加速，走代理到延迟更低的出口，而不是把 `os=akam` 分片硬改到 UPOS。
5. **系统侧**：关专用代理；避免蜂窝与 Wi‑Fi 来回切；测速时不要同时开大下载。

## Loon 里建议看的字段

- 原始 URL 主机名 / 修改后的链接主机名  
- 状态码（206 正常分片；4xx/5xx 或长时间 pending 要标出来）  
- 策略（直连还是节点）与耗时  
- 是否 MitM（HTTPS 分片改写通常需要）

## 最小记录模板

```text
设备: iPadOS x.x / Loon x.x (build)
App: 普通版 or 国际版 / 版本号
插件: 关 / 开（#!version）
BV + 清晰度:
卡顿时原始 Host:
卡顿时修改后 Host:
当时速度: 0KB / ~x MB
同片其他分片 Host 是否混用:
```

把上面填齐后，才能判断是继续固定 `mirrorali`、改试 `mirrorcos`，还是国际版/Akamai 需要另一条策略。
