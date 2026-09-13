type Props = {
  id: string
  gamma: number
  contrast: number
  gainR: number
  gainG: number
  gainB: number
}

export function CalibrationFilter({ id, gamma, contrast, gainR, gainG, gainB }: Props) {
  const exponent = 1 / gamma
  const intercept = 0.5 * (1 - contrast)
  return (
    <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feComponentTransfer>
          <feFuncR type="gamma" exponent={exponent} amplitude={1} offset={0} />
          <feFuncG type="gamma" exponent={exponent} amplitude={1} offset={0} />
          <feFuncB type="gamma" exponent={exponent} amplitude={1} offset={0} />
        </feComponentTransfer>
        <feComponentTransfer>
          <feFuncR type="linear" slope={contrast} intercept={intercept} />
          <feFuncG type="linear" slope={contrast} intercept={intercept} />
          <feFuncB type="linear" slope={contrast} intercept={intercept} />
        </feComponentTransfer>
        <feComponentTransfer>
          <feFuncR type="linear" slope={gainR} intercept={0} />
          <feFuncG type="linear" slope={gainG} intercept={0} />
          <feFuncB type="linear" slope={gainB} intercept={0} />
        </feComponentTransfer>
      </filter>
    </svg>
  )
}
