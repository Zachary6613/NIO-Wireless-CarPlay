import { useLayoutEffect, useRef, useState } from 'react'

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, set] = useState({ w: window.innerWidth, h: window.innerHeight })
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ w: number; h: number } | null>(null)

  // Layout effect + a synchronous seed: the first paint already uses the element's
  // real box. The ResizeObserver alone reports only after that paint, which showed
  // up as a visible re-zoom when entering the page. The seed must match the
  // observer's contentRect (content box), so padding is subtracted.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const cs = getComputedStyle(el)
    const padX =
      (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
    const padY =
      (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0)
    const w = Math.round(el.clientWidth - padX)
    const h = Math.round(el.clientHeight - padY)
    if (w > 0 && h > 0) {
      set((prev) => (prev.w !== w || prev.h !== h ? { w, h } : prev))
    }

    const flush = () => {
      rafRef.current = null
      const next = pendingRef.current
      pendingRef.current = null
      if (!next) return
      set((prev) => (prev.w !== next.w || prev.h !== next.h ? next : prev))
    }

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (!r) return
      // Round to avoid sub-pixel churn
      pendingRef.current = { w: Math.round(r.width), h: Math.round(r.height) }
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush)
      }
    })

    ro.observe(el)
    return () => {
      ro.disconnect()
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return [ref, size] as const
}
