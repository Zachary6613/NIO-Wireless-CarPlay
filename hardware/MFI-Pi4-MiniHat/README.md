# MFI Pi 4 Mini HAT - Rev A

这是树莓派 4B 前六针直插的最小 MFi Authentication 3.0 验证板。

## 接口

| J1 | Raspberry Pi 4B | 网络 |
|---:|---|---|
| 1 | 3V3 | +3V3 |
| 2 | 5V | NC |
| 3 | GPIO2/SDA1 | SDA |
| 4 | 5V | NC |
| 5 | GPIO3/SCL1 | SCL |
| 6 | GND | GND |

## U1 XDFN 顶视图

| U1 pin | 信号 | 连接 |
|---:|---|---|
| 1 | GND | GND |
| 2 | NC | 必须悬空 |
| 3 | NC | 必须悬空 |
| 4 | GND | GND |
| 5 | SDA | J1.3 + 12k pull-up |
| 6 | SCL | J1.5 + 12k pull-up |
| 7 | GND | GND |
| 8 | VCC | +3V3 |
| EP | exposed pad | GND |

## LIVI

```json
{
  "carPlayMfiI2cBus": 1,
  "carPlayMfiPowerGpio": -1
}
```

Rev A 使用常供电设计。芯片会在约 3.2-4.8 秒无活动后进入低功耗，并由发往其地址的 I2C
通信唤醒。不要把 LIVI 电源 GPIO 配为正数。

## 制造说明

- 2-layer FR-4, 1.6 mm, 1 oz copper。
- U1 XDFN 焊盘按手册推荐：0.90 x 0.30 mm，0.50 mm pitch。
- U1 中央焊盘 1.76 x 1.50 mm 接地；钢网分窗，避免漂移。
- U1 激光点/Pin 1 丝印必须与 PCB 圆点一致。
- J1 是装在 PCB 底面的 2x3 母座，板从树莓派上方插入。
- 下单前在 KiCad 中再次执行 DRC，并用所购母座的实物尺寸检查机械间隙。

## 已生成文件

- `MFI-Pi4-MiniHat.kicad_pcb`：KiCad 10 PCB 源文件。
- `BOM.csv`：首版物料表。
- `drc-errors.txt`：KiCad 10.0.6 检查报告；0 errors、0 unconnected pads。
- `fabrication/`：Gerber、Excellon 钻孔、钻孔图和 Gerber job 文件。
- `MFI-Pi4-MiniHat-Gerbers.zip`：可交给板厂的压缩包。
- `panel-2x2/`：60.1 x 44.1 mm 的 2×2 同款鼠咬孔拼板，带工艺边、定位孔、基准点、
  完整拼板 BOM/CPL 和嘉立创下单说明。优先使用其中的
  `JLCPCB-2x2-Panel-Order-Package.zip` 下单。

DRC 清零只说明设计满足当前规则，不代替封装实物核对。尤其需要向供应商确认购买的是
`MFI343S00177-L` XDFN 版本，并确认 2x3 母座从 PCB 底面装配后的方向和高度。
