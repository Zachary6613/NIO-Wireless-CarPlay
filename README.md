# NIO Wireless CarPlay

在蔚来车机浏览器中使用的**无线 CarPlay** 方案。树莓派运行车载主机软件
[LIVI](https://github.com/f-io/LIVI)，负责 CarPlay 会话、MFi 认证、蓝牙、Wi-Fi 热点和音视频；
车机无需安装任何 App，只用浏览器打开树莓派提供的网页，即可看到 CarPlay 画面并进行触控操作。

## 工作原理

```text
iPhone
  │  蓝牙：发现、配对、Wi-Fi 切换
  │  Wi-Fi：CarPlay 会话、音视频与控制
  ▼
Raspberry Pi 4/5  +  LIVI
  │  I2C：MFi 证书 / 签名（MFI343S00177 小板）
  │
  │  车内局域网（以太网或第二张 Wi-Fi 网卡）
  ▼
蔚来车机浏览器：网页画面 + 触摸输入（https://<树莓派IP>:8080）
```

- CarPlay 协议与 MFi 认证由 Rust 编写的 **livi-helperd** 守护进程完成
- 画面经局域网以低延迟方式推送，浏览器使用 **WebCodecs** 硬解 H.264 并绘制到 canvas
- GStreamer 运行时已随仓库一起提供（linux-x64 / linux-arm64 / macos-arm64），无需自行安装

## 硬件需求

| 项目 | 说明 |
|---|---|
| 树莓派 | 4B 或 5（Pi 3 及更早不满足 OpenGL ES 3.x 要求） |
| 系统 | 64-bit Raspberry Pi OS（Debian 13 Trixie），需桌面环境 |
| MFi 小板 | 本项目 `hardware/` 中的 MFI343S00177 MiniHat，I2C-1，3.3V 常供电 |
| Wi-Fi | 一张独立 5GHz 适配器，作为 CarPlay 热点（勿与车机访问链路混用同一网卡） |
| 蓝牙 | 可先用板载蓝牙验证 |
| 供电 | 稳定的 USB-C 5V 电源 |

> MFi 芯片不是通用空白器件，需要来源合规、已写入有效证书的芯片。本仓库**不包含**任何证书、
> 私钥或认证绕过功能，使用时须遵守 Apple MFi 许可条款。

---

## 从下载到运行（完整步骤）

### 1. 启用 I2C

在树莓派上执行并重启：

```bash
sudo raspi-config nonint do_i2c 0
sudo reboot
```

确认 I2C 总线（标准 40Pin 通常是 bus 1）：

```bash
i2cdetect -l
```

### 2. 下载仓库

```bash
cd ~
git clone https://github.com/Zachary6613/NIO-Wireless-CarPlay.git
cd NIO-Wireless-CarPlay
```

仓库为私有，请确保本机已登录 GitHub（`gh auth login`）或配置好 HTTPS 凭证。

### 3. 安装系统依赖

本仓库自带安装脚本，无需从上游下载。它会安装运行所需的系统依赖（蓝牙、hostapd、
dnsmasq、avahi、pulseaudio、libva 等）以及编译和打包 AppImage 所需的主机工具
（gcc/make 工具链、patchelf、libfuse2、压缩库），但不会下载预编译 AppImage，也不会
改动 I2C 配置：

```bash
./scripts/setup-system.sh
```

> 首次执行 `pnpm run build:linux:arm64` 时，electron-builder 还会自动下载它自己的
> AppImage 工具集（mksquashfs + 静态 runtime），需联网一次；也可用环境变量
> `APPIMAGE_TOOLS_PATH` 指定预先下载好的工具集目录。

脚本结束时会检查 Node.js、pnpm、Rust 工具链。若提示缺失，按以下方式安装：

```bash
# Node.js + pnpm（Raspberry Pi OS / Debian 13 源中的 Node 为 20）
sudo apt-get install -y nodejs npm
sudo corepack enable

# Rust 工具链（编译 livi-helperd 和原生模块）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
```

确认版本：

```bash
node -v        # v20 / v22 / v24
pnpm -v        # 本仓库锁定 pnpm 12.4.1
cargo --version
```

> 注意：不要运行 `software/LIVI/scripts/install/install.sh`。那是上游"预编译 AppImage
> 安装器"，会下载上游 AppImage、创建自启项，并按上游硬件把 MFi 配为软件 I2C bus 2 /
> GPIO 21，与本项目的硬件 I2C-1 / 常供电方案冲突。

### 4. 安装依赖

```bash
cd software/LIVI
pnpm install
```

安装结束后会自动重建原生模块并编译 livi-crypto。

### 5. 编译 helperd 守护进程

CarPlay 连接依赖 livi-helperd：

```bash
pnpm run build:helperd
```

产物位于 `native/livi-helperd/target/release/livi-helperd`。启动脚本会自动找到它；
应用正常运行后也可能把它复制到 `~/.config/LIVI/driver/` 下。

> helperd 通过 `sudo -n -E` 以 root 身份运行（需要访问硬件、管理网络）。请确认当前用户
> 具备免密 sudo，或按需配置 `/etc/sudoers`。

### 6.（可选）生成网页桥接的 HTTPS 证书

部分浏览器只在安全上下文（HTTPS）下允许 WebCodecs。如需 HTTPS，生成自签名证书：

```bash
mkdir -p ~/.config/LIVI/web-bridge
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout ~/.config/LIVI/web-bridge/key.pem \
  -out ~/.config/LIVI/web-bridge/cert.pem \
  -subj "/CN=LIVI CarPlay Bridge" \
  -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}'),DNS:localhost"
```

### 7. 启动

回到项目根目录，一键启动（自动配置显示、GStreamer、helperd、kiosk，并在检测到证书时启用 HTTPS 网页桥接）：

```bash
cd ~/NIO-Wireless-CarPlay
./software/LIVI/run-livi-dev.sh
```

可用的覆盖方式：

```bash
LIVI_KIOSK=0 ./software/LIVI/run-livi-dev.sh          # 临时退出全屏 kiosk
LIVI_WEB_PORT=9000 ./software/LIVI/run-livi-dev.sh    # 更改网页端口
```

### 8. 首次配置与访问

1. 在 LIVI 设置界面中配置 MFi（也可参考 [software/config.example.json](software/config.example.json)）：
   - `carPlayMfiI2cBus`：`1`（以 `i2cdetect -l` 实测为准）
   - `carPlayMfiPowerGpio`：`-1`（Rev A 小板常供电）
2. 在设置中选择蓝牙适配器、Wi-Fi 网卡并配置热点的国家/频段/信道
3. iPhone 通过蓝牙配对后，CarPlay 会自动切换到 Wi-Fi 连接
4. 车机浏览器打开（自签名证书会有警告，选择"高级 → 继续前往"即可）：

```text
https://<树莓派IP>:8080
```

可先在树莓派本地显示器跑通整条 CarPlay 链路，再进行车机浏览器联调。

---

## 打包部署

打包成无需 Node 环境即可运行的 AppImage（产物在 `dist/`）：

```bash
cd software/LIVI
pnpm run build:linux:arm64     # 树莓派；x86 设备使用 pnpm run build:linux:x64
```

## 验证 MFi 小板

停止 LIVI 后执行（认证过程中不要反复扫描 I2C 总线）：

```bash
./scripts/check-mfi.sh 1
```

芯片应答地址应为 `0x10`。此脚本只能确认 I2C 通信，不能验证 MFi 证书是否有效。

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 系统架构、数据路径与风险边界 |
| [docs/bringup.md](docs/bringup.md) | 从空白树莓派到首轮联调 |
| [docs/development.md](docs/development.md) | LIVI 修改、构建与上游说明 |
| [software/README.md](software/README.md) | LIVI 源码结构与功能说明 |
| [hardware/README.md](hardware/README.md) | MFi 小板设计与连接表 |
| [hardware/preflight-checklist.md](hardware/preflight-checklist.md) | 投板 / 上电检查清单 |

## 常见问题

- **网页打不开 / CarPlay 连不上**：确认 8080 端口已监听（`ss -tln | grep 8080`），
  且 helperd 已编译。启动脚本找不到 helperd 会直接报错提示。
- **浏览器提示不安全**：自签名证书的正常现象，继续前往即可；车机浏览器若无法跳过警告，
  需将证书导入车机信任库。
- **只有画面没有声音**：部分浏览器限制局域网自动播放音频，需在页面内手动点"启用声音"。
- **I2C 地址不通**：以 `i2cdetect -l` 的实测总线号为准，并确认小板为 3.3V 供电。

## 许可证

LIVI 部分基于 GPL-3.0-or-later，修改和分发时请保留 [software/LIVI/LICENSE](software/LIVI/LICENSE)
与版权信息。
