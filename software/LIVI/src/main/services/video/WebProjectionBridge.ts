import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import http from 'node:http'
import { Server } from 'socket.io'

type Codec = 'h264' | 'h265' | 'vp9' | 'av1'
type TouchHandler = (x: number, y: number, action: number) => void

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>LIVI CarPlay</title>
  <style>
    html,body{width:100%;height:100%;margin:0;background:#000;overflow:hidden;touch-action:none}
    video{width:100%;height:100%;display:block;object-fit:contain;background:#000;touch-action:none}
    #state{position:fixed;left:12px;top:10px;padding:6px 10px;border-radius:6px;color:#fff;background:#0009;font:14px system-ui;pointer-events:none}
    button{position:fixed;top:10px;z-index:2;padding:8px 12px}
    #full{right:12px}#sound{right:82px}
  </style>
</head>
<body>
  <video id="screen" autoplay muted playsinline></video>
  <div id="state">正在等待 CarPlay 视频…</div>
  <button id="sound">启用声音</button>
  <button id="full">全屏</button>
  <script>
    const video = document.querySelector('#screen')
    const state = document.querySelector('#state')
    let aborter = null
    const reconnect = async () => {
      aborter?.abort()
      aborter = new AbortController()
      state.style.display = 'block'
      state.textContent = '正在连接视频…'
      const mediaSource = new MediaSource()
      video.src = URL.createObjectURL(mediaSource)
      await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }))
      let sourceBuffer
      try {
        sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="__AVC_CODEC__"')
      } catch (e) {
        state.textContent = '浏览器不支持此 H.264 格式：' + e.message
        return
      }
      try {
        const response = await fetch('/stream.mp4?t=' + Date.now(), { signal: aborter.signal, cache: 'no-store' })
        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
        const reader = response.body.getReader()
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          await new Promise((resolve, reject) => {
            const ok = () => { cleanup(); resolve() }
            const bad = () => { cleanup(); reject(sourceBuffer.error || new Error('append failed')) }
            const cleanup = () => { sourceBuffer.removeEventListener('updateend', ok); sourceBuffer.removeEventListener('error', bad) }
            sourceBuffer.addEventListener('updateend', ok)
            sourceBuffer.addEventListener('error', bad)
            sourceBuffer.appendBuffer(value)
          })
          video.play().catch(() => {})
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          state.textContent = '视频流中断，正在重连…'
          setTimeout(reconnect, 1000)
        }
      }
    }
    video.addEventListener('playing', () => { state.style.display = 'none' })
    video.addEventListener('error', () => { state.textContent = '视频解码失败，正在重连…'; setTimeout(reconnect, 1000) })
    reconnect()

    function point(e) {
      const r = video.getBoundingClientRect()
      const vw = video.videoWidth || 16
      const vh = video.videoHeight || 9
      const scale = Math.min(r.width / vw, r.height / vh)
      const w = vw * scale, h = vh * scale
      const ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2
      return {
        x: Math.max(0, Math.min(1, (e.clientX - ox) / w)),
        y: Math.max(0, Math.min(1, (e.clientY - oy) / h))
      }
    }
    function send(e, action) {
      const p = point(e)
      fetch('/touch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: p.x, y: p.y, action }),
        keepalive: true
      }).catch(() => {})
    }
    video.addEventListener('pointerdown', e => {
      video.setPointerCapture(e.pointerId); send(e, 14); e.preventDefault()
    })
    let queued = null, movePending = false
    video.addEventListener('pointermove', e => {
      if (!video.hasPointerCapture(e.pointerId)) return
      queued = e
      if (movePending) return
      movePending = true
      requestAnimationFrame(() => {
        const q = queued; queued = null; movePending = false; if (q) send(q, 15)
      })
      e.preventDefault()
    })
    for (const name of ['pointerup','pointercancel']) video.addEventListener(name, e => {
      send(e, 16); try { video.releasePointerCapture(e.pointerId) } catch {}; e.preventDefault()
    })
    document.querySelector('#full').onclick = () => document.documentElement.requestFullscreen?.()
    const soundButton = document.querySelector('#sound')
    let audioAbort = null
    soundButton.onclick = async () => {
      audioAbort?.abort()
      audioAbort = new AbortController()
      soundButton.textContent = '正在连接声音…'
      try {
        const ctx = new AudioContext({ sampleRate: 48000 })
        await ctx.resume()
        const response = await fetch('/audio.pcm?t=' + Date.now(), { signal: audioAbort.signal, cache: 'no-store' })
        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
        soundButton.style.display = 'none'
        const reader = response.body.getReader()
        let carry = new Uint8Array(0)
        let nextTime = ctx.currentTime + 0.12
        while (true) {
          const { value, done } = await reader.read()
          if (done) throw new Error('audio stream ended')
          const data = new Uint8Array(carry.length + value.length)
          data.set(carry); data.set(value, carry.length)
          const bytes = data.length - (data.length % 4)
          carry = data.slice(bytes)
          if (!bytes) continue
          const frames = bytes / 4
          const buffer = ctx.createBuffer(2, frames, 48000)
          const left = buffer.getChannelData(0), right = buffer.getChannelData(1)
          const view = new DataView(data.buffer, data.byteOffset, bytes)
          for (let i = 0; i < frames; i++) {
            left[i] = view.getInt16(i * 4, true) / 32768
            right[i] = view.getInt16(i * 4 + 2, true) / 32768
          }
          if (nextTime < ctx.currentTime || nextTime > ctx.currentTime + 0.8) nextTime = ctx.currentTime + 0.08
          const source = ctx.createBufferSource()
          source.buffer = buffer; source.connect(ctx.destination); source.start(nextTime)
          nextTime += frames / 48000
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          soundButton.style.display = 'block'
          soundButton.textContent = '重试声音'
        }
      }
    }
  </script>
</body>
</html>`

class WebProjectionBridge {
  private server: http.Server | null = null
  private io: Server | null = null
  private response: http.ServerResponse | null = null
  private pipeline: ChildProcessWithoutNullStreams | null = null
  private audioProcess: ChildProcessWithoutNullStreams | null = null
  private audioResponse: http.ServerResponse | null = null
  private codec: Codec = 'h264'
  private codecData: Buffer | null = null
  private lengthSize = 4
  private parameterSets: Buffer[] = []
  private frameCount = 0
  private gop: Buffer[] = []
  private gopBytes = 0
  private touchHandler: TouchHandler | null = null

  get enabled(): boolean {
    return process.env.LIVI_WEB_BRIDGE === '1'
  }

  start(touchHandler: TouchHandler): void {
    if (!this.enabled || this.server) return
    this.touchHandler = touchHandler
    const port = Number.parseInt(process.env.LIVI_WEB_PORT ?? '8080', 10) || 8080
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
    this.io = new Server(this.server, { cors: { origin: '*' } })
    this.io.on('connection', (socket) => {
      socket.on('touch', (value: unknown) => {
        const v = value as { x?: unknown; y?: unknown; action?: unknown }
        const x = Number(v?.x)
        const y = Number(v?.y)
        const action = Number(v?.action)
        if (!Number.isFinite(x) || !Number.isFinite(y) || ![14, 15, 16].includes(action)) return
        this.touchHandler?.(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)), action)
      })
    })
    this.server.on('error', (e) => console.error('[WebBridge] server:', e.message))
    this.server.listen(port, '0.0.0.0', () => {
      console.log(`[WebBridge] open http://0.0.0.0:${port}`)
    })
  }

  configure(codec: Codec, codecData?: Buffer | null): void {
    if (!this.enabled) return
    this.codec = codec
    if (!codecData?.length) return
    this.codecData = Buffer.from(codecData)
    if (codec === 'h264') this.parseAvcC(this.codecData)
    console.log(`[WebBridge] video config codec=${codec} bytes=${codecData.length} parameterSets=${this.parameterSets.length}`)
  }

  push(codec: Codec, sample: Buffer): void {
    if (!this.enabled || codec !== 'h264') return
    if (codec !== this.codec) this.configure(codec, this.codecData)
    const annexB = this.toAnnexB(sample)
    if (annexB.length === 0) return
    this.frameCount += 1
    if (this.frameCount === 1) console.log(`[WebBridge] first video frame bytes=${sample.length} annexB=${annexB.length}`)
    if (this.hasIdr(annexB)) {
      this.gop = []
      this.gopBytes = 0
    }
    if (this.gop.length || this.hasIdr(annexB)) {
      this.gop.push(annexB)
      this.gopBytes += annexB.length
      if (this.gopBytes > 8 * 1024 * 1024) {
        this.gop = []
        this.gopBytes = 0
      }
    }
    if (!this.pipeline?.stdin.writable) return
    try {
      this.pipeline.stdin.write(annexB)
    } catch {}
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/touch' && req.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= 4096) chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          if (size > 4096) throw new Error('body too large')
          const v = JSON.parse(Buffer.concat(chunks).toString()) as { x?: unknown; y?: unknown; action?: unknown }
          const x = Number(v.x)
          const y = Number(v.y)
          const action = Number(v.action)
          if (!Number.isFinite(x) || !Number.isFinite(y) || ![14, 15, 16].includes(action)) throw new Error('invalid touch')
          this.touchHandler?.(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)), action)
          res.writeHead(204).end()
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }
    if (url.pathname === '/audio.pcm') {
      this.stopAudio()
      this.audioResponse = res
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store, no-cache, must-revalidate',
        connection: 'close',
        'access-control-allow-origin': '*'
      })
      const child = spawn('/usr/bin/parec', [
        '--device=@DEFAULT_MONITOR@', '--format=s16le', '--rate=48000', '--channels=2'
      ], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
      this.audioProcess = child
      child.stdout.on('data', (chunk: Buffer) => this.audioResponse?.write(chunk))
      child.stderr.on('data', (chunk: Buffer) => console.warn(`[WebBridge:audio] ${chunk.toString().trim()}`))
      child.on('exit', () => {
        if (this.audioProcess === child) this.audioProcess = null
      })
      res.on('close', () => {
        if (this.audioResponse === res) this.stopAudio()
      })
      return
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(PAGE.replace('__AVC_CODEC__', this.avcCodecString()))
      return
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, codec: this.codec, streaming: Boolean(this.pipeline) }))
      return
    }
    if (url.pathname !== '/stream.mp4') {
      res.writeHead(404).end()
      return
    }
    if (this.codec !== 'h264') {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Browser bridge requires an H.264 CarPlay session. Reconnect the phone.')
      return
    }
    this.stopPipeline()
    this.response = res
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'cache-control': 'no-store, no-cache, must-revalidate',
      connection: 'close',
      'access-control-allow-origin': '*'
    })
    res.on('close', () => {
      if (this.response === res) this.stopPipeline()
    })
    this.startPipeline()
  }

  private startPipeline(): void {
      const binary = '/usr/bin/ffmpeg'
      if (!this.response) {
        return
      }
    const args = [
      '-loglevel', 'warning', '-fflags', '+genpts', '-r', '30',
      '-f', 'h264', '-i', 'pipe:0', '-an', '-c:v', 'copy',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '100000', '-f', 'mp4', 'pipe:1'
    ]
    // ffmpeg supplies monotonically increasing timestamps for AirPlay's raw
    // access units and copies H.264 into fragmented MP4 without re-encoding.
    const child = spawn(binary, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.pipeline = child
    child.stdout.on('data', (chunk: Buffer) => this.response?.write(chunk))
    child.stderr.on('data', (chunk: Buffer) => console.warn(`[WebBridge:gstreamer] ${chunk.toString().trim()}`))
    child.on('exit', (code) => {
      if (this.pipeline === child) this.pipeline = null
      console.log(`[WebBridge] muxer exited (${code ?? 'signal'})`)
    })
    if (this.parameterSets.length) child.stdin.write(Buffer.concat(this.parameterSets))
    for (const frame of this.gop) child.stdin.write(frame)
  }

  private stopPipeline(): void {
    const child = this.pipeline
    this.pipeline = null
    if (child) {
      child.stdin.end()
      child.kill('SIGTERM')
    }
    const res = this.response
    this.response = null
    if (res && !res.writableEnded) res.end()
  }

  private stopAudio(): void {
    const child = this.audioProcess
    this.audioProcess = null
    if (child) child.kill('SIGTERM')
    const res = this.audioResponse
    this.audioResponse = null
    if (res && !res.writableEnded) res.end()
  }

  private parseAvcC(data: Buffer): void {
    if (data.length < 7 || data[0] !== 1) return
    this.lengthSize = (data[4] & 3) + 1
    const sets: Buffer[] = []
    let offset = 6
    const spsCount = data[5] & 0x1f
    const readSet = (): boolean => {
      if (offset + 2 > data.length) return false
      const size = data.readUInt16BE(offset)
      offset += 2
      if (offset + size > data.length) return false
      sets.push(Buffer.concat([Buffer.from([0, 0, 0, 1]), data.subarray(offset, offset + size)]))
      offset += size
      return true
    }
    for (let i = 0; i < spsCount; i++) if (!readSet()) return
    if (offset >= data.length) return
    const ppsCount = data[offset++]
    for (let i = 0; i < ppsCount; i++) if (!readSet()) return
    this.parameterSets = sets
  }

  private avcCodecString(): string {
    if (!this.codecData || this.codecData.length < 4 || this.codecData[0] !== 1) return 'avc1.640028'
    return `avc1.${this.codecData.subarray(1, 4).toString('hex')}`
  }

  private toAnnexB(sample: Buffer): Buffer {
    // CarPlay frames are length-prefixed. A perfectly valid 4-byte length such
    // as 0x0000012c resembles a three-byte Annex-B start code, so never detect
    // Annex-B before attempting the documented length-prefixed parse.
    const out: Buffer[] = []
    let offset = 0
    let valid = true
    while (offset + this.lengthSize <= sample.length) {
      let size = 0
      for (let i = 0; i < this.lengthSize; i++) size = size * 256 + sample[offset + i]
      offset += this.lengthSize
      if (size <= 0 || offset + size > sample.length) {
        valid = false
        break
      }
      out.push(Buffer.from([0, 0, 0, 1]), sample.subarray(offset, offset + size))
      offset += size
    }
    if (valid && offset === sample.length && out.length) return Buffer.concat(out)
    if (sample.length >= 4 && sample[0] === 0 && sample[1] === 0 && (sample[2] === 1 || (sample[2] === 0 && sample[3] === 1))) {
      return sample
    }
    return Buffer.alloc(0)
  }

  private hasIdr(data: Buffer): boolean {
    for (let i = 0; i + 4 < data.length; i++) {
      let nal = -1
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) nal = i + 3
      else if (i + 5 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) nal = i + 4
      if (nal >= 0 && (data[nal] & 0x1f) === 5) return true
    }
    return false
  }
}

export const webProjectionBridge = new WebProjectionBridge()
