import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { Server, type Socket } from 'socket.io'

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
    canvas,video{width:100%;height:100%;display:block;object-fit:contain;background:#000;touch-action:none}
    #touch-surface{position:fixed;inset:0;z-index:1;touch-action:none;background:transparent}
    #state{position:fixed;left:12px;top:10px;padding:6px 10px;border-radius:6px;color:#fff;background:#0009;font:14px system-ui;pointer-events:none}
    button{position:fixed;top:10px;z-index:2;padding:8px 12px}
    #full{right:12px}#sound{right:82px}
  </style>
</head>
<body>
  <canvas id="screen"></canvas>
  <video id="mse-screen" autoplay muted playsinline style="display:none"></video>
  <div id="touch-surface"></div>
  <div id="state">正在等待 CarPlay 视频…</div>
  <button id="sound">启用声音</button>
  <button id="full">全屏</button>
  <script src="/bridge-client.js"></script>
  <script>
    const screen = document.querySelector('#screen')
    const mseVideo = document.querySelector('#mse-screen')
    const context = screen.getContext('2d', { alpha: false, desynchronized: true })
    const state = document.querySelector('#state')
    const useWebCodecs = !!window.VideoDecoder && window.isSecureContext
    const surface = document.querySelector('#touch-surface')
    if (!useWebCodecs) { screen.style.display = 'none'; mseVideo.style.display = 'block' }
    let decoder = null
    let decoderCodec = ''
    let configuredCodec = ''
    let waitingForKey = true
    let timestamp = 0
    let mseAbort = null
    let mseUrl = null
    let mseGeneration = 0
    let touchCount = 0
    let lastTouchAction = 0
    const socket = io({ transports: ['websocket'], reconnection: true, query: { videoMode: useWebCodecs ? 'webcodecs' : 'mse' } })
    function requestKeyframe() { if (socket.connected) socket.emit('request-keyframe') }
    function stopMse() {
      mseGeneration++
      mseAbort?.abort()
      mseAbort = null
      mseVideo.removeAttribute('src')
      mseVideo.load()
      if (mseUrl) URL.revokeObjectURL(mseUrl)
      mseUrl = null
    }
    async function startMse(codec) {
      stopMse()
      const generation = mseGeneration
      const mime = 'video/mp4; codecs="' + codec + '"'
      if (!window.MediaSource || !MediaSource.isTypeSupported(mime)) {
        state.textContent = '浏览器不支持 H.264 MSE 播放：' + codec
        return
      }
      const mediaSource = new MediaSource()
      mseUrl = URL.createObjectURL(mediaSource)
      mseVideo.src = mseUrl
      mseAbort = new AbortController()
      try {
        await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve, { once: true }))
        if (generation !== mseGeneration) return
        const buffer = mediaSource.addSourceBuffer(mime)
        const response = await fetch('/stream.mp4?t=' + Date.now(), { signal: mseAbort.signal, cache: 'no-store' })
        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
        const reader = response.body.getReader()
        requestKeyframe()
        let lastSeek = 0
        let lastTrim = 0
        let playStarted = false
        while (generation === mseGeneration) {
          const { value, done } = await reader.read()
          if (done) throw new Error('视频流中断')
          await new Promise((resolve, reject) => {
            const ok = () => { cleanup(); resolve() }
            const bad = () => { cleanup(); reject(new Error('视频缓冲失败')) }
            const cleanup = () => { buffer.removeEventListener('updateend', ok); buffer.removeEventListener('error', bad) }
            buffer.addEventListener('updateend', ok)
            buffer.addEventListener('error', bad)
            buffer.appendBuffer(value)
          })
          const now = performance.now()
          if (mseVideo.buffered.length && now - lastSeek > 500) {
            const end = mseVideo.buffered.end(mseVideo.buffered.length - 1)
            if (end - mseVideo.currentTime > 1.5 || !playStarted)
              mseVideo.currentTime = Math.max(0, end - 0.2)
            lastSeek = now
            const start = mseVideo.buffered.start(0)
            if (end - start > 10 && now - lastTrim > 1000) {
              await new Promise((resolve, reject) => {
                const ok = () => { cleanup(); resolve() }
                const bad = () => { cleanup(); reject(new Error('视频缓冲清理失败')) }
                const cleanup = () => { buffer.removeEventListener('updateend', ok); buffer.removeEventListener('error', bad) }
                buffer.addEventListener('updateend', ok)
                buffer.addEventListener('error', bad)
                buffer.remove(0, end - 5)
              })
              lastTrim = now
            }
          }
          if (!playStarted && mseVideo.buffered.length) {
            playStarted = true
            mseVideo.play().catch(() => { playStarted = false })
          }
        }
      } catch (error) {
        if (generation === mseGeneration && error.name !== 'AbortError') {
          state.style.display = 'block'
          state.textContent = '视频流中断：' + error.message + '，正在重连…'
          socket.emit('viewer-error', String(error.message))
          setTimeout(() => { if (generation === mseGeneration) startMse(codec) }, 1000)
        }
      }
    }
    mseVideo.addEventListener('playing', () => { state.style.display = 'none' })
    function resetDecoder(codec) {
      if (decoder) { try { decoder.close() } catch {} }
      decoderCodec = codec
      waitingForKey = true
      timestamp = 0
      decoder = new VideoDecoder({
        output(frame) {
          if (screen.width !== frame.displayWidth || screen.height !== frame.displayHeight) {
            screen.width = frame.displayWidth
            screen.height = frame.displayHeight
          }
          context.drawImage(frame, 0, 0, screen.width, screen.height)
          frame.close()
          state.style.display = 'none'
        },
        error(error) {
          state.style.display = 'block'
          state.textContent = '视频解码失败：' + error.message
          waitingForKey = true
          queueMicrotask(() => {
            if (decoderCodec) resetDecoder(decoderCodec)
            requestKeyframe()
          })
        }
      })
      decoder.configure({ codec, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' })
    }
    socket.on('connect', () => { state.style.display = 'block'; state.textContent = '已连接，等待关键帧…'; requestKeyframe() })
    socket.on('disconnect', (reason) => {
      if (!useWebCodecs) stopMse()
      if (decoder) { try { decoder.close() } catch {} }
      decoder = null
      configuredCodec = ''
      waitingForKey = true
      state.style.display = 'block'
      state.textContent = '视频连接中断（' + reason + '），正在重连…'
    })
    socket.on('connect_error', error => {
      state.style.display = 'block'
      state.textContent = '视频连接失败：' + error.message
    })
    socket.on('video-config', ({ codec }) => {
      if (codec === configuredCodec) return
      try {
        if (useWebCodecs) resetDecoder(codec)
        else { void startMse(codec) }
        configuredCodec = codec
        state.textContent = '等待关键帧…'
      } catch (error) { state.textContent = 'WebCodecs 初始化失败：' + error.message }
    })
    socket.on('video-frame', ({ key, data }) => {
      if (!useWebCodecs) return
      if (!decoder || decoder.state !== 'configured') return
      if (waitingForKey && !key) return
      // A dropped P-frame invalidates the GOP: resume only on the next IDR.
      if (decoder.decodeQueueSize > 3) {
        resetDecoder(decoderCodec)
        requestKeyframe()
        state.style.display = 'block'
        state.textContent = '正在追赶实时画面…'
        if (!key) return
      }
      try {
        decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: timestamp++, data }))
        waitingForKey = false
      } catch {
        waitingForKey = true
        state.style.display = 'block'
        state.textContent = '视频帧错误，等待关键帧…'
      }
    })
    setInterval(() => {
      if (socket.connected && (useWebCodecs ? waitingForKey : state.style.display !== 'none')) requestKeyframe()
    }, 1500)
    setInterval(() => {
      if (!socket.connected) return
      const end = mseVideo.buffered.length ? mseVideo.buffered.end(mseVideo.buffered.length - 1) : 0
      socket.emit('viewer-status', {
        mode: useWebCodecs ? 'webcodecs' : 'mse',
        readyState: mseVideo.readyState,
        networkState: mseVideo.networkState,
        currentTime: mseVideo.currentTime,
        bufferedEnd: end,
        paused: mseVideo.paused,
        seeking: mseVideo.seeking,
        touches: touchCount,
        lastTouchAction,
        message: state.textContent
      })
    }, 2000)

    function point(e) {
      const r = surface.getBoundingClientRect()
      const vw = (useWebCodecs ? screen.width : mseVideo.videoWidth) || 16
      const vh = (useWebCodecs ? screen.height : mseVideo.videoHeight) || 9
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
      touchCount++
      lastTouchAction = action
      socket.emit('touch', { x: p.x, y: p.y, action })
    }
    surface.addEventListener('pointerdown', e => {
      surface.setPointerCapture(e.pointerId); send(e, 14); e.preventDefault()
    })
    let queued = null, movePending = false
    surface.addEventListener('pointermove', e => {
      if (!surface.hasPointerCapture(e.pointerId)) return
      queued = e
      if (movePending) return
      movePending = true
      requestAnimationFrame(() => {
        const q = queued; queued = null; movePending = false; if (q) send(q, 15)
      })
      e.preventDefault()
    })
    for (const name of ['pointerup','pointercancel']) surface.addEventListener(name, e => {
      send(e, 16); try { surface.releasePointerCapture(e.pointerId) } catch {}; e.preventDefault()
    })
    surface.addEventListener('contextmenu', e => e.preventDefault())
    document.querySelector('#full').onclick = () => document.documentElement.requestFullscreen?.()
    const soundButton = document.querySelector('#sound')
    let audioAbort = null
    let audioContext = null
    soundButton.onclick = async () => {
      audioAbort?.abort()
      audioContext?.close().catch(() => {})
      audioAbort = new AbortController()
      soundButton.textContent = '正在连接声音…'
      try {
        const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
        audioContext = ctx
        await ctx.resume()
        const response = await fetch('/audio.pcm?t=' + Date.now(), { signal: audioAbort.signal, cache: 'no-store' })
        if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
        soundButton.style.display = 'none'
        const reader = response.body.getReader()
        let carry = new Uint8Array(0)
        let nextTime = ctx.currentTime + 0.06
        const scheduled = new Set()
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
          if (nextTime > ctx.currentTime + 0.2) {
            for (const old of scheduled) { try { old.stop() } catch {} }
            scheduled.clear()
            nextTime = ctx.currentTime + 0.06
          } else if (nextTime < ctx.currentTime + 0.02) {
            nextTime = ctx.currentTime + 0.04
          }
          const source = ctx.createBufferSource()
          source.buffer = buffer; source.connect(ctx.destination)
          source.onended = () => scheduled.delete(source)
          scheduled.add(source)
          source.start(nextTime)
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
  private mseResponse: http.ServerResponse | null = null
  private muxer: ChildProcessWithoutNullStreams | null = null
  private muxerNeedsKey = true
  private audioProcess: ChildProcessWithoutNullStreams | null = null
  private audioResponse: http.ServerResponse | null = null
  private codec: Codec = 'h264'
  private codecData: Buffer | null = null
  private lengthSize = 4
  private parameterSets: Buffer[] = []
  private frameCount = 0
  private keyframeCount = 0
  private gop: Buffer[] = []
  private gopBytes = 0
  private touchHandler: TouchHandler | null = null
  private keyframeHandler: (() => void) | null = null
  private lastKeyframeRequest = 0

  get enabled(): boolean {
    return process.env.LIVI_WEB_BRIDGE === '1'
  }

  start(touchHandler: TouchHandler, keyframeHandler: () => void): void {
    if (!this.enabled || this.server) return
    this.touchHandler = touchHandler
    this.keyframeHandler = keyframeHandler
    const port = Number.parseInt(process.env.LIVI_WEB_PORT ?? '8080', 10) || 8080
    const certPath = process.env.LIVI_WEB_TLS_CERT
    const keyPath = process.env.LIVI_WEB_TLS_KEY
    const tls = certPath && keyPath
    this.server = tls
      ? https.createServer(
          { cert: readFileSync(certPath), key: readFileSync(keyPath) },
          (req, res) => this.handleRequest(req, res)
        )
      : http.createServer((req, res) => this.handleRequest(req, res))
    this.io = new Server(this.server, { cors: { origin: '*' } })
    this.io.on('connection', (socket) => {
      console.log(`[WebBridge] viewer connected id=${socket.id}`)
      socket.data.needsKey = true
      socket.emit('video-config', { codec: this.avcCodecString() })
      if (socket.handshake.query.videoMode === 'webcodecs' && this.gopBytes <= 256 * 1024) {
        for (const frame of this.gop) this.sendVideoFrame(socket, frame, this.hasIdr(frame))
      }
      this.requestKeyframe()
      socket.on('request-keyframe', () => this.requestKeyframe())
      socket.on('viewer-error', (message: unknown) => {
        if (typeof message === 'string') console.warn(`[WebBridge] viewer error: ${message.slice(0, 200)}`)
      })
      socket.on('viewer-status', (value: unknown) => {
        if (value && typeof value === 'object') socket.data.viewerStatus = { ...value, at: Date.now() }
      })
      socket.on('disconnect', (reason) => console.log(`[WebBridge] viewer disconnected: ${reason}`))
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
      console.log(`[WebBridge] open ${tls ? 'https' : 'http'}://0.0.0.0:${port}`)
    })
  }

  private requestKeyframe(): void {
    const now = Date.now()
    if (now - this.lastKeyframeRequest < 1000) return
    this.lastKeyframeRequest = now
    this.keyframeHandler?.()
  }

  configure(codec: Codec, codecData?: Buffer | null): void {
    if (!this.enabled) return
    if (codecData?.length && codec === this.codec && this.codecData?.equals(codecData)) return
    this.codec = codec
    if (!codecData?.length) return
    this.codecData = Buffer.from(codecData)
    if (codec === 'h264') this.parseAvcC(this.codecData)
    this.gop = []
    this.gopBytes = 0
    this.io?.emit('video-config', { codec: this.avcCodecString() })
    console.log(
      `[WebBridge] video config codec=${codec} bytes=${codecData.length} parameterSets=${this.parameterSets.length}`
    )
  }

  push(codec: Codec, sample: Buffer): void {
    if (!this.enabled || codec !== 'h264') return
    if (codec !== this.codec) this.configure(codec, this.codecData)
    const annexB = this.toAnnexB(sample)
    if (annexB.length === 0) return
    this.frameCount += 1
    if (this.frameCount === 1)
      console.log(`[WebBridge] first video frame bytes=${sample.length} annexB=${annexB.length}`)
    const key = this.hasIdr(annexB)
    if (key) this.keyframeCount += 1
    const frame =
      key && this.parameterSets.length ? Buffer.concat([...this.parameterSets, annexB]) : annexB
    if (key) {
      this.gop = []
      this.gopBytes = 0
    }
    if (this.gop.length || key) {
      this.gop.push(frame)
      this.gopBytes += frame.length
      if (this.gopBytes > 8 * 1024 * 1024) {
        this.gop = []
        this.gopBytes = 0
      }
    }
    for (const socket of this.io?.sockets.sockets.values() ?? []) {
      if (socket.handshake.query.videoMode === 'webcodecs') this.sendVideoFrame(socket, frame, key)
    }
    if (!this.muxer?.stdin.writable) return
    if (this.muxerNeedsKey && !key) return
    if (this.muxer.stdin.writableLength > 512 * 1024) {
      this.stopMuxer()
      return
    }
    this.muxerNeedsKey = false
    this.muxer.stdin.write(frame)
  }

  private sendVideoFrame(socket: Socket, frame: Buffer, key: boolean): void {
    const transport = socket.conn.transport as unknown as { socket?: { bufferedAmount?: number } }
    if ((transport.socket?.bufferedAmount ?? 0) > 512 * 1024) {
      socket.data.needsKey = true
      return
    }
    if (socket.data.needsKey && !key) return
    socket.emit('video-frame', { key, data: frame })
    socket.data.needsKey = false
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/bridge-client.js') {
      try {
        const script = readFileSync('node_modules/socket.io/client-dist/socket.io.min.js')
        res.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store'
        })
        res.end(script)
      } catch (error) {
        console.error('[WebBridge] client script:', error)
        res.writeHead(500).end()
      }
      return
    }
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
          const v = JSON.parse(Buffer.concat(chunks).toString()) as {
            x?: unknown
            y?: unknown
            action?: unknown
          }
          const x = Number(v.x)
          const y = Number(v.y)
          const action = Number(v.action)
          if (!Number.isFinite(x) || !Number.isFinite(y) || ![14, 15, 16].includes(action))
            throw new Error('invalid touch')
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
      const child = spawn(
        '/usr/bin/parec',
        [
          '--device=@DEFAULT_MONITOR@', '--format=s16le', '--rate=48000', '--channels=2',
          '--latency-msec=20', '--process-time-msec=10'
        ],
        { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      this.audioProcess = child
      child.stdout.on('data', (chunk: Buffer) => this.audioResponse?.write(chunk))
      child.stderr.on('data', (chunk: Buffer) =>
        console.warn(`[WebBridge:audio] ${chunk.toString().trim()}`)
      )
      child.on('exit', () => {
        if (this.audioProcess === child) this.audioProcess = null
      })
      res.on('close', () => {
        if (this.audioResponse === res) this.stopAudio()
      })
      return
    }
    if (url.pathname === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      })
      res.end(PAGE)
      return
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(
        JSON.stringify({
          ok: true,
          codec: this.codec,
          viewers: this.io?.engine.clientsCount ?? 0,
          frames: this.frameCount,
          keyframes: this.keyframeCount,
          cachedGopBytes: this.gopBytes,
          muxer: Boolean(this.muxer),
          muxerNeedsKey: this.muxerNeedsKey,
          viewerStatus: [...(this.io?.sockets.sockets.values() ?? [])].map((socket) => socket.data.viewerStatus ?? null)
        })
      )
      return
    }
    if (url.pathname === '/stream.mp4') {
      if (this.codec !== 'h264') {
        res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('An H.264 CarPlay session is required')
        return
      }
      this.stopMuxer()
      this.mseResponse = res
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'access-control-allow-origin': '*'
      })
      res.on('close', () => {
        if (this.mseResponse === res) {
          console.log('[WebBridge] MSE stream closed by viewer')
          this.stopMuxer()
        }
      })
      this.startMuxer()
      return
    }
    res.writeHead(404).end()
  }

  private startMuxer(): void {
    const res = this.mseResponse
    if (!res) return
    const args = [
      '-loglevel', 'warning', '-probesize', '65536', '-analyzeduration', '100000',
      '-fflags', '+genpts', '-r', '30',
      '-f', 'h264', '-i', 'pipe:0', '-an', '-c:v', 'copy',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '100000', '-flush_packets', '1', '-f', 'mp4', 'pipe:1'
    ]
    const child = spawn('/usr/bin/ffmpeg', args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.muxer = child
    this.muxerNeedsKey = true
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.mseResponse !== res || res.writableEnded) return
      if (res.writableLength > 512 * 1024) {
        this.stopMuxer()
        return
      }
      res.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) =>
      console.warn(`[WebBridge:muxer] ${chunk.toString().trim()}`)
    )
    child.on('error', (error) => console.error('[WebBridge:muxer]', error))
    child.on('exit', () => {
      if (this.muxer === child) {
        console.warn('[WebBridge] MSE muxer exited')
        this.stopMuxer()
      }
    })
    if (this.gop.length && this.gopBytes <= 1024 * 1024) {
      for (const frame of this.gop) child.stdin.write(frame)
      this.muxerNeedsKey = false
    }
    this.requestKeyframe()
  }

  private stopMuxer(): void {
    const child = this.muxer
    this.muxer = null
    this.muxerNeedsKey = true
    if (child) {
      child.stdin.end()
      child.kill('SIGTERM')
    }
    const res = this.mseResponse
    this.mseResponse = null
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
    if (!this.codecData || this.codecData.length < 4 || this.codecData[0] !== 1)
      return 'avc1.640028'
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
    if (
      sample.length >= 4 &&
      sample[0] === 0 &&
      sample[1] === 0 &&
      (sample[2] === 1 || (sample[2] === 0 && sample[3] === 1))
    ) {
      return sample
    }
    return Buffer.alloc(0)
  }

  private hasIdr(data: Buffer): boolean {
    for (let i = 0; i + 4 < data.length; i++) {
      let nal = -1
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) nal = i + 3
      else if (
        i + 5 < data.length &&
        data[i] === 0 &&
        data[i + 1] === 0 &&
        data[i + 2] === 0 &&
        data[i + 3] === 1
      )
        nal = i + 4
      if (nal >= 0 && (data[nal] & 0x1f) === 5) return true
    }
    return false
  }
}

export const webProjectionBridge = new WebProjectionBridge()
