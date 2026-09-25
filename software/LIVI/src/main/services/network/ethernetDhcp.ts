import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveHelperBin } from '@main/services/projection/driver/helper/helperSupervisor'

const exec = promisify(execFile)

export type EthernetDhcpStatus = {
  installed: boolean
  enabled: boolean
  active: boolean
  fallback: string
  profile: string
}

async function run(action: 'status' | 'on' | 'off' | 'set-fallback', value?: string): Promise<string> {
  if (process.platform !== 'linux') throw new Error('Ethernet DHCP is available on Linux only')
  const { stdout } = await exec('sudo', ['-n', resolveHelperBin(), '--ethernet-dhcp', action, ...(value ? [value] : [])], {
    timeout: 45_000,
    maxBuffer: 64 * 1024
  })
  return stdout
}

export async function getEthernetDhcpStatus(): Promise<EthernetDhcpStatus> {
  const values = Object.fromEntries(
    (await run('status')).trim().split('\n').map((line) => line.trim().split(/\s+/, 2))
  )
  return {
    installed: values.installed === 'true',
    enabled: values.enabled === 'true',
    active: values.active === 'true',
    fallback: values.fallback ?? '192.168.77.1/24',
    profile: values.profile ?? ''
  }
}

export async function setEthernetDhcpEnabled(enabled: boolean): Promise<EthernetDhcpStatus> {
  await run(enabled ? 'on' : 'off')
  return getEthernetDhcpStatus()
}

export async function setEthernetFallback(address: string): Promise<EthernetDhcpStatus> {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}\/(?:\d|[12]\d|30)$/.test(address)) throw new Error('请输入 IPv4/CIDR，例如 192.168.77.1/24')
  await run('set-fallback', address)
  return getEthernetDhcpStatus()
}
