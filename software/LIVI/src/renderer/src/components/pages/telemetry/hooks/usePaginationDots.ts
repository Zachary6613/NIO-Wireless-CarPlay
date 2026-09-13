import { useCallback } from 'react'

export const usePaginationDots = (isNavbarHidden: boolean, isNavPresent = true) => {
  return {
    showDots: isNavPresent ? !isNavbarHidden : true,
    revealDots: useCallback(() => {}, [])
  }
}
