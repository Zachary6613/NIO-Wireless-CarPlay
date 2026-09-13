# LIVI 修改与开发

## 源码基线

- 上游仓库：`https://github.com/f-io/LIVI.git`
- 导入分支：`main`
- 导入提交：`4bfd62a004de1d114748759943521a7d8917c279`
- 本地目录：`software/LIVI/`

LIVI 源码已作为本项目的一部分导入，不是 Git submodule，因此可以直接修改并随本项目提交。
上游项目采用 GPL-3.0；修改和分发时保留 `software/LIVI/LICENSE` 与版权信息。

## 推荐分支

```bash
git switch -c feature/nio-web-bridge
```

建议先把改动分为三层：

1. `MFi/Pi 4 bring-up`：只调整 I2C bus 和常供电配置，验证原生 LIVI。
2. `browser bridge`：加入低延迟画面、音频和触摸桥接。
3. `vehicle integration`：根据蔚来浏览器实测结果处理网络、全屏、保活和启动流程。

## 构建

依赖与命令会随上游变化，以 `software/LIVI/README.md` 为准。当前上游在 Debian、Ubuntu、
Raspberry Pi OS 上提供安装脚本，并要求 Node.js、pnpm、Rust、GStreamer 和本机构建工具。

进入源码目录后：

```bash
cd software/LIVI
pnpm run install:ci
pnpm run build:linux:arm64
```

树莓派 4B 使用 arm64 系统。首次联调先运行未修改的 LIVI，确认 MFi 和无线 CarPlay 正常，
再开发网页桥接层，以便把硬件、CarPlay 链路和浏览器问题分开定位。

## MFi 配置

```json
{
  "carPlayMfiI2cBus": 1,
  "carPlayMfiPowerGpio": -1
}
```

Rev A 没有电源控制 GPIO。调试 I2C 前停止 LIVI，然后从项目根目录执行：

```bash
./scripts/check-mfi.sh 1
```

## 同步上游

本仓库保留一个名为 `livi-upstream` 的远程地址后，可使用：

```bash
git fetch livi-upstream
git subtree pull --prefix=software/LIVI livi-upstream main --squash
```

在执行 subtree 同步前先提交本地修改，并在独立分支中操作；上游目录规模较大，冲突时不要直接
覆盖自己的网页桥接改动。
