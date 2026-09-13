# 首板检查清单

## 投板前

- [ ] 用正式 MFi343S00177 数据包逐脚复核 symbol 和 footprint。
- [ ] 确认封装视图是 top view 还是 bottom view，Pin 1 标记一致。
- [x] U1 使用 Pi 3.3 V 供电，符合手册 1.71–3.6 V 范围。
- [ ] 实机确认 SDA/SCL 总线上拉等效阻值；小板各装 12 kΩ。
- [ ] LIVI 的 `carPlayMfiPowerGpio` 为 `-1`（Rev A 常供电）。
- [ ] 2x3 母座方向、高度和 Pi 元件干涉通过实物机械检查。
- [ ] 所有未用 Pi GPIO 均为 NC。
- [ ] ERC、DRC 无未解释错误。

## 不装 MFi 芯片的裸板

- [ ] 对地短路检查。
- [ ] 3V3、U1 VCC、SDA、SCL、GND 连通性检查。
- [ ] 确认 Pin 2/4 的 5 V 与小板电路保持断开。
- [ ] SDA/SCL 空闲电压符合芯片 I/O 规格。

## 装芯片后首次上电

- [ ] 使用限流电源，先把限流设为保守值。
- [ ] 测量静态电流和芯片温升。
- [ ] 停止 LIVI 后运行 `scripts/check-mfi.sh`。
- [ ] `/dev/i2c-1` 能在 `0x10` 看到器件。
- [ ] LIVI 日志能读出 device/protocol version。
- [ ] 先验证证书读取，再进行 iPhone challenge-response。
