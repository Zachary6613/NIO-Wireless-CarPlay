# 软件说明与开发计划

本文基于仓库内 `software/LIVI/` 的实际源码整理，用于说明 LIVI 已有能力、代码结构、依赖，
以及本项目从 Raspberry Pi 4B 原型到蔚来车机浏览器可用版本的开发路径。

## 1. 项目目标与当前判断

目标链路：

```text
iPhone
  ├─ Bluetooth：发现、配对、无线 CarPlay handover
  └─ 5 GHz Wi-Fi：CarPlay 会话、音视频与控制
             │
             v
Raspberry Pi 4B + MFi 认证板 + LIVI
  ├─ I2C：MFi challenge / certificate / signature
  ├─ LIVI：CarPlay 协议、解密、音视频和输入
  └─ Web Bridge：视频、音频、状态和触摸转发（本项目新增）
             │
             v
蔚来车机浏览器
```

LIVI 可以作为 Linux 上的原生 CarPlay/Android Auto Head Unit，但它不是现成的 Web CarPlay
服务。当前视频在树莓派本机由 GStreamer 解码，并由 Wayland 合成器显示；Electron 页面依赖主进程
IPC。现有 4000 端口 Socket.IO 只负责车辆遥测，不传 CarPlay 视频、音频或输入。因此，不能简单地
把 LIVI 的 renderer 目录用 HTTP 发布给车机浏览器，本项目必须新增浏览器桥接层。

建议采用 **WebRTC 为主、WebSocket 为辅** 的桥接方案：WebRTC 承载低延迟视频和音频，DataChannel
或 WebSocket 回传触摸、按键与连接状态。最终方案要以实车浏览器能力探测结果为准。

## 2. LIVI 基线

- 本地源码：`software/LIVI/`
- 上游项目：<https://github.com/f-io/LIVI>
- 导入的上游提交：`4bfd62a004de1d114748759943521a7d8917c279`
- `package.json` 版本：`9.0.0`
- 许可证：`GPL-3.0-or-later`
- 桌面框架：Electron 44 + React 19 + TypeScript + Vite
- 原生层：Rust 2024 edition + GStreamer + Wayland
- 目标平台：Linux arm64/x86_64、macOS；本项目目标为 Raspberry Pi OS 64-bit

LIVI 已作为普通目录导入，不是 Git submodule。对 LIVI 的修改会随本仓库提交。发布包含修改的
产品或软件包时，应按 GPL-3.0-or-later 履行对应的源码提供和许可证义务。

## 3. 目录结构

```text
software/
├─ README.md                     # 本文：软件总览和开发计划
├─ config.example.json           # 本项目的 MFi 最小配置示例
└─ LIVI/
   ├─ src/
   │  ├─ main/                   # Electron 主进程和核心业务
   │  │  ├─ app/                 # 启动、生命周期、GPU、合成器和 Wi-Fi 参数
   │  │  ├─ config/              # config.json 路径、加载和校验
   │  │  ├─ ipc/                 # 主进程与 React renderer 的 IPC
   │  │  ├─ protocol/            # Electron 自定义 app 协议
   │  │  ├─ services/
   │  │  │  ├─ projection/       # CarPlay/Android Auto 会话核心
   │  │  │  │  ├─ driver/cp/     # CarPlay 协议栈、配对、MFi、流媒体、HID
   │  │  │  │  ├─ driver/aa/     # Android Auto 协议栈及 protobuf
   │  │  │  │  ├─ services/      # 会话、设备、音频、媒体、导航、视频平面
   │  │  │  │  └─ ipc/           # 投屏数据和控制的 Electron IPC
   │  │  │  ├─ video/            # GStreamer 视频播放器与 gst-host 控制
   │  │  │  ├─ audio/            # 输出、麦克风、系统音量和蓝牙音频角色
   │  │  │  ├─ telemetry/        # 遥测、GNSS、CarPlay/AA 适配器
   │  │  │  ├─ link/             # LIVI Link/Dongle 管理
   │  │  │  ├─ custom/           # 自定义页面代理和主题
   │  │  │  └─ Socket.ts         # 端口 4000 的遥测 Socket.IO 服务
   │  │  ├─ shared/              # 主进程/renderer 共用类型、配置和工具
   │  │  └─ window/              # 主屏、仪表屏和辅助屏窗口管理
   │  ├─ preload/                # 安全暴露给 renderer 的 Electron API
   │  └─ renderer/               # React 车机 UI
   │     └─ src/
   │        ├─ components/       # 页面、布局、导航、投屏 worker
   │        ├─ routes/           # Dashboard/Media/Camera/Custom/Settings
   │        ├─ store/            # Zustand 状态
   │        ├─ hooks/            # 网络、自动隐藏、输入、FFT 等
   │        ├─ locales/          # 英/德/法/乌克兰语
   │        └─ theme/            # MUI 主题与颜色
   ├─ native/
   │  ├─ livi-helperd/           # 特权后台进程和连接协议（Rust workspace）
   │  ├─ livi-gst-video/         # 视频、音频、麦克风、NAL、播放器和 host
   │  ├─ livi-compositor/        # 基于 Smithay 的嵌套 Wayland 合成器
   │  ├─ livi-crypto/            # ChaCha20-Poly1305 N-API 原生模块
   │  └─ livi-host-proto/        # Electron 与原生 host 的消息协议
   ├─ assets/                    # 图标、Linux 服务/udev/sudoers、GStreamer 资源
   ├─ scripts/                   # 安装、构建、GStreamer 检查和调试工具
   ├─ docs/                      # LIVI 上游文档与截图
   ├─ package.json               # JS 依赖、构建、测试命令
   ├─ pnpm-lock.yaml             # 锁定的 JS 依赖
   └─ electron-builder.yml       # AppImage/dmg 打包配置
```

### 3.1 核心运行关系

```text
React renderer
      ⇅ Electron IPC
Electron main / ProjectionService
      ├─ CarPlay TypeScript stack
      ├─ Android Auto TypeScript stack
      ├─ livi-helperd：USB、iAP2、MFi、Wi-Fi、蓝牙相关特权操作
      ├─ livi-gst-host / livi-gst-video：收流、解密、解码、播放、麦克风
      └─ livi-compositor：Electron UI 与原生视频平面的零拷贝合成
```

在 Linux 上，GStreamer 管线运行在独立的 `livi-gst-host` 子进程中，视频通过原生 Wayland 平面
显示，而不是作为 HTML `<video>` 元素进入 React DOM。这是浏览器桥接需要改动原生媒体链路的
主要原因。

### 3.2 Node.js 与 Rust 的职责边界

LIVI 不是单纯的 Node.js 应用，而是“TypeScript/Node.js 控制层 + Rust 原生层 + React UI”：

| 层 | 当前职责 |
| --- | --- |
| TypeScript / Electron main | CarPlay 上层协议与会话编排、Pair Setup/Verify、RTSP、HID、设备与配置管理、启动 Rust 子进程 |
| React renderer | LIVI 导航栏、设置、设备列表、Dashboard、媒体和摄像头等本地 UI |
| `livi-helperd`（Rust） | I2C MFi、USB/iAP2、session I/O、Wi-Fi 等底层或特权操作，以及诊断工具 |
| `livi-gst-video`（Rust） | CarPlay 视频/音频接收、解密后的媒体处理、NAL、GStreamer 解码播放和麦克风上行 |
| `livi-crypto`（Rust） | 通过 N-API 提供 ChaCha20-Poly1305 等原生密码运算 |
| `livi-compositor`（Rust） | Electron UI 与 GStreamer Wayland 视频平面的零拷贝合成、多屏和裁剪 |
| `livi-host-proto`（Rust） | Node.js 与原生 host 之间的控制和媒体消息协议 |

精简初期可以去掉 Electron/Chromium 和 React 主界面，但仍保留普通 Node.js 进程运行现有 CarPlay
TypeScript 栈。只有将这部分协议栈迁移到 Rust 后，Node.js 才能完全移除；这不是首版目标。

## 4. LIVI 已开发的功能

### 4.1 CarPlay

- Linux/macOS 上的有线和无线 CarPlay Head Unit。
- 本地 I2C MFi Authentication 3.0；也支持通过 LIVI Link 远程认证。
- 无线 CarPlay 的蓝牙配对、Wi-Fi AP handover、mDNS 发现和自动重连。
- 主屏和仪表屏视频，支持 H.264/H.265、硬件解码和 Linux 零拷贝显示。
- 媒体、导航提示、语音、电话等音频播放，以及麦克风上行。
- 触摸、多点触摸、旋钮/D-Pad、硬按键输入。
- 正在播放信息、专辑封面、逐向导航数据、手机电量和信号状态。
- 日/夜模式、GPS 和车辆遥测向手机转发。
- 多手机并发会话和活动会话快速切换。

### 4.2 Android Auto

- 全平台有线 Android Auto。
- Linux 无线 Android Auto。
- 视频、音频、麦克风、输入、导航、媒体信息、传感器等通道。
- 大量 Android Auto protobuf 服务定义已经包含在源码内。

本项目第一阶段只以 CarPlay 为目标，Android Auto 保持上游能力但不作为验收项，以免扩大联调面。

### 4.3 显示与 UI

- 主屏、仪表屏、辅助屏多窗口输出，可分别配置分辨率和功能。
- 主画面/仪表画面的 view area、safe area 和是否绘制到安全区外。
- Gamma、对比度、RGB 通道校准。
- 深色/浅色主题、亮度、界面缩放、左右舵设置。
- Dashboard、媒体页、倒车摄像头页、自定义 URL 页面和设置页。
- 倒车信号触发摄像头自动切换。
- Kiosk/headless 安装模式和开机启动配套资源。

### 4.4 设备、车辆和系统能力

- 设备列表、连接状态、配对记录、自动连接和多会话管理。
- Socket.IO 遥测输入/广播，默认端口 `4000`：
  `telemetry:push` 写入，`telemetry:update` 广播快照。
- NMEA-0183 GNSS；u-blox 设备额外支持 UBX 硬件信息。
- GNSS 校时、根据位置设置时区，并将数据写入 `gpsData.json`。
- 系统音量、输出/输入设备选择、音频频谱数据。
- 在线更新、依赖自检、状态文件、日志和调试开关。
- 自定义主题 CSS、外部自定义页面代理、按键绑定。

上游 README 明确标注 Dashboard 仍在开发中：遥测数据模型较完整，但 UI 只展示其中一部分。

## 5. 依赖清单

### 5.1 硬件依赖

| 组件 | 用途 | 本项目建议 |
| --- | --- | --- |
| Raspberry Pi 4B | 运行 LIVI、媒体桥接和 Web 服务 | 4 GB 及以上，arm64 系统，主动散热 |
| MFI343S00177 认证板 | CarPlay accessory authentication | I2C-1，7-bit 地址 `0x10`，Rev A 常供电 |
| 5 GHz Wi-Fi 接口 | iPhone 加入 CarPlay AP | 使用兼容 AP 模式的独立 USB 网卡 |
| 蓝牙接口 | CarPlay 发现、配对与 handover | 初期可用板载蓝牙，稳定性不足时改 USB 蓝牙 |
| 第二网络接口 | 车机浏览器访问 Pi Web Bridge | 优先车机热点/USB 以太网；不要占用 CarPlay AP 网卡 |
| 音频输入 | Siri/电话麦克风上行 | USB 麦克风或可靠的 USB 声卡 |
| 音频输出 | 本地验证或兜底 | 浏览器音频未验证前保留 Pi 本地输出能力 |
| 稳定电源与散热 | 防止降频、掉线和文件系统损坏 | 原型使用稳定 5 V，车载版另做 12 V 电源保护 |

Pi 4 板载 Wi-Fi 不能同时被默认假定为“CarPlay 专用 AP”和“车机访问网络”。是否能通过多虚拟
接口稳定并发取决于驱动、信道和车机网络，首版应按两张网络接口设计。

### 5.2 操作系统与运行依赖

- Raspberry Pi OS / Debian 13 Trixie 64-bit。
- OpenGL ES 3.x；LIVI 因此不支持 Pi 3 及更早型号。
- GStreamer 1.0 及 base 开发库。
- Wayland、`libwayland`、`libxkbcommon`；headless 模式使用 Cage/seatd/wlr-randr。
- BlueZ 与 PipeWire/WirePlumber 蓝牙音频插件。
- `hostapd`、`dnsmasq`、`iw`、`rfkill`：建立和管理无线 AP。
- Avahi daemon/tools：无线 CarPlay mDNS 发布和发现。
- PipeWire/PulseAudio 兼容工具：音频与系统音量控制。
- FUSE 3：运行 AppImage。
- 内核 I2C、GPIO character device、USB、蓝牙和目标 Wi-Fi 网卡驱动。
- 视频运行库还涉及 VA-API、libssh；Pi 上的实际硬解码路径必须用目标系统验证。

仓库中的 `software/LIVI/scripts/install/packages.txt` 是安装器和应用内依赖检查的实际清单，应以它
和上游 `software/LIVI/README.md` 为最终依据。

### 5.3 构建依赖

- Node.js 24.x，含 Corepack。
- pnpm 12.4.1（由 `packageManager` 锁定）。
- Rust stable 1.88 或更高版本。
- GCC/G++、make、pkg-config、CMake。
- GStreamer、Wayland、xkbcommon 开发头文件。
- Electron 44、React 19、TypeScript 7、Vite 8。
- UI/状态：Material UI、Emotion、Zustand、React Router、i18next。
- 协议/通信：protobufjs、Socket.IO。
- 质量工具：Vitest、Testing Library、Biome、Husky。

### 5.4 MFi 配置

Rev A 认证板接 Pi 4B 的 I2C-1，且没有软件控制电源：

```json
{
  "carPlayMfiI2cBus": 1,
  "carPlayMfiPowerGpio": -1
}
```

MFi 器件必须来源合规并具有有效配置。本项目不包含证书、私钥或认证绕过能力。

## 6. 本项目需要新增的模块

建议尽量保留 LIVI 上游代码边界，将新增代码放在明确命名的 bridge 模块中：

```text
software/LIVI/
├─ native/livi-gst-video/.../web_fanout/  # 原始视频/音频的旁路输出
├─ src/main/services/webBridge/           # 会话、信令、鉴权、输入映射
└─ src/web/                               # 车机浏览器专用轻量前端
```

目标模块职责：

1. **Media tap**：在 CarPlay 媒体已解密、可用的最早位置旁路主视频和音频，不破坏本地显示。
2. **WebRTC gateway**：把 H.264（必要时重编码）和 Opus 音频发送给车机浏览器；处理关键帧、拥塞、
   重连和时钟同步。
3. **Signaling/control**：提供 HTTP(S)、WebSocket/DataChannel，发布连接状态并接收触摸/按键。
4. **Input mapper**：按实际视频 viewport、safe area、旋转和缩放，把浏览器坐标映射回 LIVI 输入。
5. **Web client**：全屏视频、启动页、连接状态、横竖屏/尺寸适配、触摸捕获、重连和诊断面板。
6. **Security**：仅绑定车机侧接口；首次配对码或预共享 token；限制跨域和控制来源；不把遥测写接口
   裸露到不可信网络。
7. **Observability**：端到端延迟、帧率、丢帧、码率、CPU/GPU、温度、Wi-Fi 信号、断线原因。

不要把当前端口 4000 的遥测 Socket.IO 直接扩展成无鉴权的远程控制入口。浏览器桥接应有独立端口、
协议版本和访问控制。

### 6.1 CarPlay 视频与触摸数据路径

当前视频并不经过 React `<video>`：

```text
iPhone CarPlay 视频
  → TypeScript 协议栈完成会话、密钥和屏幕参数协商
  → livi-gst-video / livi-gst-host 接收并处理 H.264/H.265
  → GStreamer 解码
  → Wayland 视频平面
  → livi-compositor 与本地 UI 合成
```

Web Bridge 优先在解码前对已解密 H.264 做旁路并封装为 WebRTC，避免 Pi 再编码；若车机浏览器
不兼容该 profile/level，再使用 Pi 硬件解码、缩放并重新编码为兼容的 H.264。开发阶段保留
Wayland 与 WebRTC 双输出，便于对照；浏览器链路成熟后默认关闭本地输出。

触摸则走反方向，CarPlay 按钮和手势最终由 iPhone 解释：

```text
车机浏览器 PointerEvent
  → WebRTC DataChannel / WebSocket
  → 按 viewport、黑边、safe area、旋转和缩放换算坐标
  → LIVI input API
  → CarPlay HID report
  → iPhone 处理点击/滑动/多点触摸并生成新画面
```

浏览器不需要理解 CarPlay 的按钮结构。它只捕获触点 ID、down/move/up、坐标和时间；服务端动态
下发真实视频区域与 CarPlay 分辨率，落在黑边或默认界面上的触摸不转发给 iPhone。

### 6.2 最终 CarPlay-only 运行形态

产品目标不是保留一套完整 LIVI 车机桌面，而是把 LIVI 精简成无线 CarPlay 后台核心：

```text
Raspberry Pi OS Lite
├─ Node.js CarPlay Core
│  ├─ CarPlay 协议、配对与会话
│  └─ 配置、状态、输入和进程编排
├─ Rust livi-helperd
│  └─ MFi、I2C、USB/iAP2、Wi-Fi
├─ Rust/GStreamer Media Gateway
│  └─ H.264、音频、麦克风和 WebRTC
├─ Lightweight Web Client
│  └─ 默认页、全屏视频、触摸、重连和隐藏管理入口
└─ systemd + watchdog
```

正常运行时不启动 LIVI 导航栏、Dashboard 或多窗口。正式包可以不启动 Electron renderer、
`livi-compositor`、Cage 和 Wayland 本地显示；但建议源码保留 `--local-display` 诊断构建，在浏览器
或网络异常时可接 HDMI 快速确认底层 CarPlay 是否正常。

### 6.3 可裁剪功能和依赖

CarPlay 主链路跑通且 Web Bridge 成熟后，可按构建 feature 分批关闭：

- Android Auto 协议栈、protobuf、有线/无线 AA。
- Dashboard、遥测 Socket.IO、GPS/GNSS（如果不向手机转发定位）。
- Dash/Aux 多显示、仪表流、倒车摄像头、独立媒体页和 Custom URL。
- LIVI 原导航栏、设置页、多语言、主题、显示亮度/Gamma/色彩校准。
- 多手机并发和 LIVI Link（如果产品只允许单 iPhone 且固定使用本地 I2C MFi）。
- macOS、x86_64、dmg/AppImage 和在线桌面更新逻辑。

相应可以移除 Electron/Chromium、React/MUI/Emotion、Wayland/Smithay、Cage、seatd、wlr-randr、
FUSE 等运行依赖。若 CarPlay TypeScript 栈仍在，Node.js 必须保留；GStreamer 也必须保留或由等价
媒体栈替换。WebRTC 还可能新增 `webrtcbin`、RTP、DTLS、SRTP、Opus、H.264 和 V4L2 插件，不能
把“无本地显示”等同于“不需要媒体依赖”。

无线 CarPlay 精简版仍必须保留 BlueZ、`hostapd`、`dnsmasq`、`iw`、`rfkill`、Avahi、I2C/GPIO
内核接口和基本 systemd/log/watchdog。PipeWire/WirePlumber 是否保留，取决于麦克风和最终音频
路径。删除系统包前必须用实际构建图和目标机运行检查确认没有间接引用。

### 6.4 极简车机界面

最终 Web 页面只保留以下状态：

```text
BOOTING（服务启动）
  → WAITING（默认界面，等待已配对手机）
  → PAIRING（首次蓝牙配对提示）
  → CONNECTED（CarPlay 全屏，无 LIVI 导航栏）
  → RECONNECTING（短时断线自动恢复）
  → WAITING

任意状态发生不可恢复问题 → ERROR（简短错误码与重试状态）
```

- 未连接时显示项目 Logo、连接状态和必要的首次配对提示。
- 连接后 CarPlay 视频占满有效区域，不叠加 LIVI 导航栏；触摸全部按视频区域映射给 iPhone。
- 断开后自动回到默认界面，可选择短时间保留最后一帧再切换。
- CarPlay 自己提供 Home、应用切换、地图和媒体 UI；Siri/Home/媒体键优先映射车辆实体按键。
- 保留受 PIN/token 保护的隐藏管理入口，例如长按角落，用于重新配对、重启服务、触摸校准和导出日志。

车机前端因此可以使用轻量原生 HTML/CSS/TypeScript，无需搬运 LIVI 的完整 React/MUI 页面。

### 6.5 裁剪策略

不要在联调初期直接删除上游源码，推荐按以下顺序降低回归风险：

1. 原版 LIVI 在本地显示器跑通 CarPlay。
2. Wayland 本地显示与浏览器 WebRTC 双输出，验证画面和触摸一致。
3. 增加 `carplay-web`/Cargo feature，停止启动不需要的 UI 和功能，但暂时保留源码。
4. 默认 headless，保留可选本地诊断开关。
5. 每关闭一组模块，重新验证认证、连接、视频、所有音频类型、麦克风、触摸、电话和 Siri。
6. 稳定版本再从生产构建和系统镜像中物理移除不参与编译的模块与依赖。

### 6.6 成熟后的安装与发布

最终同时提供两种交付方式：

1. **预制 Raspberry Pi OS 镜像**：用户烧录 SD 卡、插板开机并完成一次配对即可使用，适合固定硬件。
2. **`.deb`/一键安装脚本**：检查 Pi 和系统版本，安装精简依赖，部署 CarPlay Core、Web Bridge、
   Web Client、systemd/watchdog，写入默认配置并执行启动自检，适合开发、升级和维修。

开发期先维护安装脚本，内测期生成 `.deb`，成熟后发布“预制镜像 + 离线升级包”。同时提供版本
回滚、配置迁移、首次启动向导和一键诊断包。目标机只安装预编译产物，不需要 Rust、编译器或完整
前端构建工具。发布时继续履行 GPL 源码提供义务以及 MFi/CarPlay 合规要求。

## 7. 整体开发计划

下面按“每一阶段都能独立判定成败”安排。人日只是单人开发的粗略估计，实车浏览器限制和 MFi
板卡到货时间会显著影响总工期。各阶段合计约 **30～52 人日（单人约 6～11 周）**；阶段 1、
阶段 4 和部分 WebRTC 预研可以并行，总日历时间不必等于人日之和。

### 阶段 0：需求冻结与测试基线（1～2 人日）

任务：

- 确认树莓派型号/内存、系统镜像、iPhone/iOS 测试矩阵和蔚来车型/车机版本。
- 明确音频最终从车机浏览器播放，还是树莓派外接音频进入车辆 AUX/蓝牙。
- 明确 Pi 与车机的网络路径：车机热点、USB Ethernet、独立 Wi-Fi 或其他方式。
- 建立问题记录：CarPlay、Web Bridge、车辆兼容性分别跟踪。

交付/门禁：测试矩阵、网络拓扑和音频策略有书面结论；否则浏览器桥接不进入实现。

### 阶段 1：树莓派软件基线（2～3 人日，可在 MFi 板到货前完成）

任务：

- 安装 Raspberry Pi OS Trixie 64-bit，启用 SSH、I2C 和稳定的时间同步。
- 运行 LIVI 安装脚本，构建或安装 arm64 包。
- 验证 Electron UI、GStreamer、Wayland 合成器、音频输入输出、蓝牙和 5 GHz AP。
- 固定系统包版本、内核、firmware、网卡型号和配置；保存可恢复镜像。
- 跑 `pnpm run typecheck`、`pnpm run test`，记录未修改基线结果。

验收：LIVI 可开机自启，本地屏幕稳定运行 2 小时，无降频、崩溃或音频设备丢失。

### 阶段 2：MFi 板卡 bring-up（2～4 人日，板到货后）

任务：

- 按硬件清单做短路、供电、SDA/SCL 静态检查，再插入 Pi。
- 停止 LIVI 后运行 `scripts/check-mfi.sh 1`，确认 `/dev/i2c-1` 与地址 `0x10`。
- 应用 bus `1`、power GPIO `-1` 配置。
- 使用 LIVI 的 `mfi-probe`/日志验证 device/protocol version、certificate 和签名流程。
- 连续冷启动、热启动和重复认证，排除上拉、供电和接触问题。

验收：至少 20 次冷启动均能识别芯片；认证请求连续 100 次无 I2C 错误。认证器件失败时先检查
器件配置/来源，不修改软件绕过认证。

### 阶段 3：原生无线 CarPlay 闭环（3～5 人日）

任务：

- 配置专用 5 GHz Wi-Fi 接口、国家码、信道、密码和 Bluetooth adapter。
- 先跑通有线 CarPlay，再跑无线配对和 Wi-Fi handover。
- 在 Pi 本地显示器验证视频、媒体音频、导航音频、通话、Siri、麦克风和触摸。
- 验证熄屏/锁屏、断开、自动重连、多个 iPhone 切换和 AP 异常恢复。
- 采集正常会话日志和各类失败日志，形成可重复诊断流程。

验收：无线首连和自动重连稳定；连续运行 4 小时；所有音频类型、麦克风和触摸可用。此阶段不通过，
不得用 Web Bridge 掩盖底层问题。

### 阶段 4：蔚来车机浏览器能力探测（1～3 人日，与阶段 2/3 可并行）

制作一个独立 probe 页面，在实车验证：

- Chromium/WebView 版本、User-Agent、屏幕 CSS/物理尺寸、devicePixelRatio。
- WebRTC、H.264 profile/level、Opus、WebSocket、WebCodecs、MSE 支持情况。
- HTTPS/自签证书限制、混合内容、局域网地址访问、跨域和端口限制。
- `<video>` 自动播放、音频自动播放、全屏、横屏、隐藏地址栏。
- 单点/多点触摸、pointer events、长按、边缘手势和坐标精度。
- 页面切后台后的限频/暂停、熄屏、车辆休眠后网络和页面恢复。
- 10/20/30 Mbps 视频的解码、温度、卡顿和端到端延迟。

验收：形成能力报告，并选定以下路线之一：

- **A：WebRTC H.264 + Opus**（首选）：低延迟且浏览器支持最好。
- **B：WebSocket/WebTransport + WebCodecs**：仅在车机确实支持并且 WebRTC 受限时采用。
- **C：原生车机应用或硬件显示链路**：浏览器无法低延迟解码、播放音频或稳定保活时的止损方案。

### 阶段 5：浏览器桥接 MVP（8～12 人日）

任务：

- 在原生媒体管线增加非阻塞 fan-out，保留 Pi 本地显示作为对照和兜底。
- 只实现单客户端、主屏、H.264 720p60（必要时先 30 fps）、视频和单点触摸。
- 新增独立 Web 前端、HTTP 信令和 WebRTC/DataChannel。
- 实现关键帧请求、断线重连、视频尺寸变化和触摸坐标映射。
- 提供实时统计：编码/转封装延迟、网络 RTT、帧率、丢帧和码率。

验收：车机显示 CarPlay 主画面并可触摸操作；局域网稳定条件下触摸到画面响应的 P95 目标低于
200 ms，连续运行 1 小时不累计延迟。若 pass-through 与车机 H.264 profile 不兼容，再启用 Pi
硬件重编码，不应一开始就承担不必要的转码成本。

### 阶段 6：音频、麦克风与完整输入（5～8 人日）

任务：

- 加入媒体/导航/语音/电话音频，处理混音、优先级、音量和 A/V 同步。
- 验证车机浏览器是否允许稳定播放；处理首次用户手势解锁音频。
- 评估浏览器麦克风权限。如果车机不允许采集，麦克风继续接在 Pi 端并由 LIVI 上行。
- 加入多点触摸、Home/Siri/媒体键等控制，处理 safe area、旋转和 UI 缩放。
- 处理音频焦点切换、来电、Siri 和导航 ducking。

验收：媒体、导航、电话和 Siri 场景逐项通过；A/V 同步无明显漂移；回声与啸叫在可接受范围。

### 阶段 7：车辆集成与可靠性（5～10 人日）

任务：

- 加入 systemd 服务、启动顺序、watchdog、崩溃拉起和只读/可恢复文件系统策略。
- 网络接口固定命名，CarPlay AP 与车机链路隔离，加入断网自愈。
- 车机休眠/唤醒、Pi 掉电/重启、iPhone 切网、蓝牙重启等故障注入。
- 限制 Web 服务监听接口，增加配对码/token、速率限制和日志脱敏。
- 做 8～12 小时 soak test，记录 CPU/GPU、温度、内存、丢帧、延迟和重连次数。
- 根据实车视口调整分辨率、DPI、safe area、码率和触摸校准。

验收：50 次车辆/设备启动循环；12 小时连续运行；断开 Wi-Fi/蓝牙/浏览器后均可自动恢复；无未授权
控制入口暴露在 CarPlay AP 或其他不可信网络上。

### 阶段 8：发布与维护（3～5 人日）

任务：

- 生成可重复安装脚本/镜像，固定依赖和配置迁移规则。
- 补齐安装、升级、回滚、诊断、日志导出和常见故障文档。
- 建立单元测试、协议测试、媒体回放测试和树莓派硬件冒烟测试。
- 记录 LIVI 上游基线与本项目 patch，制定定期同步和冲突处理流程。
- 做 GPL、MFi、Apple 商标和分发方式审查；随分发物提供所需许可证和对应源码。

验收：一张空白 SD 卡可按文档复现；升级失败可回滚；非开发人员能导出完整诊断包。

## 8. 推荐的近期执行顺序

MFi 板仍在加工时，不需要等待：

1. 完成阶段 0 的网络与音频方案选择。
2. 立即完成阶段 1 的 Pi/LIVI 基线。
3. 同时制作阶段 4 的车机浏览器 probe 页面并实车测试。
4. 浏览器能力明确后，可在模拟 H.264/音频源上预研 WebRTC bridge。
5. MFi 板到货后完成阶段 2、3，再把真实 CarPlay 流接入 bridge。

近期第一个关键决策不是编码，而是确认“车机浏览器能否稳定访问 Pi、解码低延迟 H.264、播放音频、
回传触摸并在车辆休眠后恢复”。这个结论决定 Web Bridge 是否成立，也决定是否需要原生车机应用或
其他显示方案。

## 9. 常用构建与检查命令

```bash
cd software/LIVI
pnpm run install:ci
pnpm run typecheck
pnpm run test
pnpm run build:linux:arm64
```

MFi 静态探测前先停止 LIVI，再从项目根目录执行：

```bash
./scripts/check-mfi.sh 1
```

详细构建说明见 [`../docs/development.md`](../docs/development.md)，硬件上电流程见
[`../docs/bringup.md`](../docs/bringup.md) 和
[`../hardware/preflight-checklist.md`](../hardware/preflight-checklist.md)。
