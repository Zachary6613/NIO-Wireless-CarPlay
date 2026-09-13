# 系统架构

## 数据路径

```text
iPhone
  | Bluetooth：发现、配对、Wi-Fi handover
  | Wi-Fi：CarPlay 会话、音视频和控制
  v
Raspberry Pi 4/5 + LIVI
  | I2C：MFi challenge / certificate / signature
  +----> MFI343S00177 小板
  |
  | 车内局域网（以太网或独立 Wi-Fi 链路）
  v
蔚来车机浏览器：网页画面、触摸输入、音频策略待实车确认
```

无线 CarPlay 本身需要一张专用 Wi-Fi 接口作为 AP，并通过蓝牙完成配对与切换。若树莓派还要
同时向车机提供网页，推荐至少使用第二张网络接口，避免把 CarPlay AP 和车机访问链路混在一张
网卡上。

## 硬件基线

- Raspberry Pi 4B 或 5；Pi 3 及更早版本不满足 LIVI 的 OpenGL ES 3.x 要求。
- Raspberry Pi OS / Debian 13 Trixie，arm64。
- 独立 5 GHz Wi-Fi 适配器用于 CarPlay AP。
- 蓝牙适配器；可先用板载蓝牙验证，量产形态建议独立适配器。
- MFI343S00177 验证板，通过 I2C 接入。
- 车规环境使用时另行设计 12 V 输入保护、降压、浪涌/反接/负载突降和热设计；开发阶段先用
  稳定的 USB-C 5 V 电源。

## “网页 CarPlay”的边界

LIVI 是原生 Linux head unit，不是现成的浏览器视频服务。因此项目分两阶段：

1. 先在树莓派本地显示器上跑通 LIVI + MFi + 无线 CarPlay。
2. 再实现浏览器桥接层，把画面、触控和音频送到车机浏览器。

第二阶段必须先实测车机浏览器是否具备 WebRTC/H.264、WebSocket、全屏、触摸、多媒体自动播放
以及前后台保活能力。若浏览器禁止低延迟音频或视频解码，需改用车机原生应用或 HDMI/采集方案。

## 已从 LIVI 源码确认的接口

- 本地 MFi 后端打开 `/dev/i2c-N`。
- LIVI 会探测 `0x10` 和 `0x11`；本项目所用 Authentication 3.0 手册指定 7-bit 地址 `0x10`。
- LIVI 的可选电源 GPIO 为 active-high：先输出低，等待 50 ms，再拉高并等待 100 ms。
- 未配置电源控制时使用 `-1`，芯片应由外部常供电。
- I2C 读写涉及 device version、protocol version、certificate、challenge 和 signature 寄存器。

Rev A 小板常供电并配置 GPIO `-1`。不要用 `i2cdetect` 反复扫描正在进行认证的总线；仅在
LIVI 停止后做静态探测。
