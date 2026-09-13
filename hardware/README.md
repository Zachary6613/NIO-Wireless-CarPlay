# MFI343S00177 Raspberry Pi 验证板

## Rev A 树莓派侧连接（已确定）

| 信号 | BCM | 40Pin 物理脚 | 小板用途 |
|---|---:|---:|---|
| 3V3 | — | 1 | MFi 芯片与 I2C 上拉电源 |
| SDA1 | GPIO2 | 3 | I2C SDA |
| SCL1 | GPIO3 | 5 | I2C SCL |
| GND | — | 6 | 地 |
Rev A 不使用 MFI_PWR_EN，芯片由 3.3 V 常供电，详见 `MFI-Pi4-MiniHat/`。

Rev A 使用 2x3 母座，仅覆盖 Pin 1-6；Pin 2/4 的 5 V 焊盘保持 NC。Pin 1、Pin 3、Pin 5、
Pin 6 均设置醒目的丝印或测试点。

## Rev A 实际电路

- U1 由 Pi Pin 1 的 3.3 V 常供电，没有 EN 或负载开关。
- SDA/SCL 各使用 12 kΩ 上拉到 3.3 V。
- U1 旁路电容为 100 nF，靠近 VCC 放置。
- TP1–TP4 分别提供 3V3、SDA、SCL、GND 测试点。
- Pi Pin 2/4 的 5 V 焊盘不连接。
- J1 为底面手焊件；其余 U1/C1/R1/R2 为顶面贴片件。

## 已由手册确认

- XDFN 2 x 3 mm、8 pin、0.5 mm pitch。
- Pin 1/4/7=GND，2/3=NC，5=SDA，6=SCL，8=VCC；EP 可接地。
- VCC 1.71-3.6 V，SCL 最大 400 kHz。
- 100 nF 旁路；SDA/SCL 上拉到同一 VCC，阻值不大于 12 kΩ。
- 8-bit 写/读地址 0x20/0x21，即 Linux 7-bit 地址 0x10。

生产文件和下单说明位于 `MFI-Pi4-MiniHat/panel-2x2/`。
