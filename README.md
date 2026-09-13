# NIO Wireless Web CarPlay

在蔚来车机浏览器中显示的无线 CarPlay 原型。树莓派运行
[LIVI](https://github.com/f-io/LIVI) 并承担 CarPlay、蓝牙、Wi-Fi AP、音视频处理；
车机只通过浏览器访问树莓派提供的网页界面。

## 当前状态

- 已将 LIVI 上游源码纳入 `software/LIVI/`，可以在本仓库直接修改。
- 已确认 LIVI 可通过 Linux I2C 访问 MFi Authentication 3.0；本芯片手册指定 7-bit 地址
  `0x10`。
- 已完成 Raspberry Pi 4B 前六针直插的 Rev A 小板和 2×2 嘉立创拼板；DRC 为 0 错误、
  0 未连接。
- Rev A 使用 3.3 V 常供电、I2C-1；J1 在背面手焊，嘉立创只贴顶面 U1/C1/R1/R2。
- 蔚来车型、车机版本和浏览器能力尚待实车验证。

## 目录

- `docs/architecture.md`：系统方案和风险边界
- `docs/bringup.md`：从空白树莓派到首轮联调
- `docs/development.md`：LIVI 本地修改、构建和同步上游
- `hardware/README.md`：MFi 小板设计输入和连接表
- `hardware/preflight-checklist.md`：投板/上电检查清单
- `hardware/MFI-Pi4-MiniHat/panel-2x2/`：嘉立创 2×2 拼板生产包
- `software/LIVI/`：基于上游提交 `4bfd62a` 导入的 LIVI 源码
- `software/config.example.json`：LIVI 关键配置示例
- `scripts/check-mfi.sh`：树莓派端 I2C/GPIO 诊断脚本

## 推荐首版范围

第一版仅做 MFi 验证小板，不把 Wi-Fi、蓝牙、音频或整车电源并入同一 PCB：

1. 2x3 母座，直插 Raspberry Pi GPIO 前六针。
2. MFI343S00177、100 nF 去耦、12 kΩ I2C 上拉和测试点。
3. 默认使用 GPIO2/SDA1、GPIO3/SCL1，即 `/dev/i2c-1`。
4. Rev A 常供电，LIVI 中将电源 GPIO 配为 `-1`。

## 重要合规说明

MFi 芯片不是通用、空白加密器件。需要来源合规、已配置有效证书的器件，并遵守 Apple
MFi 许可和 CarPlay 相关条款。本项目不包含证书、私钥或认证绕过功能。
