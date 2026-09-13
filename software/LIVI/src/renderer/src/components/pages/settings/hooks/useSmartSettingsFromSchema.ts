import type { SettingsNode } from '@renderer/routes'
import type { Config } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { getValueByPath } from '../utils'
import { useSmartSettings } from './useSmartSettings'

type FlatSettings = Record<string, unknown>

type OverrideConfig = {
  transform?: (value: unknown, prev?: unknown) => unknown
  validate?: (value: unknown) => boolean
}

type Overrides = Record<string, OverrideConfig>

type NodeWithPath = { path: string }
type NodeWithTransform = { transform?: (value: unknown, prev?: unknown) => unknown }

function hasPath(node: unknown): node is NodeWithPath {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as Record<string, unknown>).path === 'string'
  )
}

function hasTransform(node: unknown): node is NodeWithTransform {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as Record<string, unknown>).transform === 'function'
  )
}

type NodeWithLabelPath = { labelPath?: string }

function hasLabelPath(node: unknown): node is NodeWithLabelPath {
  return (
    typeof node === 'object' &&
    node !== null &&
    typeof (node as Record<string, unknown>).labelPath === 'string'
  )
}

const walkSchema = (
  node: SettingsNode<Config>,
  settings: unknown,
  initial: FlatSettings,
  overrides: Overrides
): void => {
  if (node.type !== 'route') {
    if (hasPath(node) && node.path.length > 0) {
      initial[node.path] = getValueByPath(settings, node.path)

      if (hasTransform(node)) {
        overrides[node.path] = { transform: node.transform }
      }

      if (hasLabelPath(node) && node.labelPath && node.labelPath.length > 0) {
        initial[node.labelPath] = getValueByPath(settings, node.labelPath)
      }
    }
  } else {
    node.children.forEach((child) => walkSchema(child, settings, initial, overrides))
  }
}

export const useSmartSettingsFromSchema = (
  rootSchema: SettingsNode<Config>,
  settings: Config | null | undefined
) => {
  const { initialState, overrides } = useMemo(() => {
    const initialState: FlatSettings = {}
    const overrides: Overrides = {}

    walkSchema(rootSchema, settings ?? {}, initialState, overrides)

    return { initialState, overrides }
  }, [rootSchema, settings])

  const smart = useSmartSettings(initialState, settings ?? ({} as Config), { overrides })

  const requestRestart = useCallback(
    (path?: string) => {
      if (typeof smart?.requestRestart === 'function') {
        smart.requestRestart(path)
      }
    },
    [smart]
  )

  return {
    ...smart,
    requestRestart
  }
}
