# Bring-up

## 1. 树莓派系统

使用 Pi 4/5 与 64-bit Raspberry Pi OS Trixie。启用 I2C：

```bash
sudo raspi-config nonint do_i2c 0
sudo reboot
```

确认标准 40Pin 的 I2C 通常为 `/dev/i2c-1`：

```bash
i2cdetect -l
```

## 2. 先验证小板

停止 LIVI 后执行：

```bash
chmod +x scripts/check-mfi.sh
./scripts/check-mfi.sh 1
```

脚本会检查 LIVI 兼容地址；本项目芯片应答地址应为 `0x10`。这不能确认 MFi 证书是否有效。

## 3. 安装 LIVI

本仓库已经保存 LIVI 源码。全新树莓派先使用仓库自带脚本准备系统依赖（蓝牙、hostapd、
dnsmasq、avahi 等），它不会下载预编译 AppImage，也不会改动 I2C 配置：

```bash
./scripts/setup-system.sh
```

不要运行 `software/LIVI/scripts/install/install.sh`，那是上游的预编译 AppImage 安装器，
其默认 MFi 配置（软件 I2C bus 2 / GPIO 21）与本项目小板（硬件 I2C-1 / 常供电）冲突。

需要修改或从源码构建时，参见 `docs/development.md` 和 `software/LIVI/README.md`。

在 LIVI 配置中设置：

- `carPlayMfiI2cBus`: `1`
- `carPlayMfiPowerGpio`: `-1`

注意：LIVI README 展示过默认 bus `2`，但标准 Raspberry Pi 40Pin GPIO2/3 通常对应 bus `1`。
必须以目标 Pi 上 `i2cdetect -l` 的结果为准。

## 4. 无线链路

为 CarPlay AP 选择专用 Wi-Fi 接口，配置国家/频段/信道；选择蓝牙适配器完成配对。
先在树莓派本地屏幕完成整条链路，再开始车机网页桥接。

## 5. 车机网页能力采集

记录以下实测结果：

- 车型、年款、NT1/NT2/NT3 平台和车机系统版本。
- 浏览器 User-Agent。
- WebRTC、H.264 decode、WebSocket、WebAudio、触摸事件是否可用。
- 页面切后台后网络和音频是否继续。
- 可否全屏、是否允许自动播放、横竖屏与实际分辨率。
- 车机如何访问树莓派：热点、USB Ethernet、车载以太网或其他方式。
