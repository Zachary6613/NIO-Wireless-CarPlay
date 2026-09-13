import * as React from 'react'

// TODO move to the AppContext and make it global
// TODO remove document.getElementById and other and use a more react-y way to do this (ref, etc)
// TODO Align with code in the AppLayout (clusterNavHidden vs navHidden, etc)
export const useNavbarHidden = () => {
  const [navHidden, setNavHidden] = React.useState(() => {
    const el = document.getElementById('content-root')
    return el?.getAttribute('data-nav-hidden') === '1'
  })
  const [navPresent, setNavPresent] = React.useState(() => {
    const el = document.getElementById('content-root')
    return el?.getAttribute('data-nav-present') !== '0'
  })

  React.useLayoutEffect(() => {
    const el = document.getElementById('content-root')
    if (!el) return

    const read = () => {
      setNavHidden(el.getAttribute('data-nav-hidden') === '1')
      setNavPresent(el.getAttribute('data-nav-present') !== '0')
    }
    read()

    const mo = new MutationObserver(read)
    mo.observe(el, { attributes: true, attributeFilter: ['data-nav-hidden', 'data-nav-present'] })

    return () => mo.disconnect()
  }, [])

  return {
    isNavbarHidden: navHidden,
    isNavPresent: navPresent,
    onSetNavHidden: setNavHidden
  }
}
