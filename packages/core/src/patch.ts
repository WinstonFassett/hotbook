export interface PatchContext {
  // 'updateNow' = commit to the source
  // 'updatePending' = preview / drag / tentative, may be discarded
  // 'rejected' = the source rejected the pending update; roll back
  phase: 'updateNow' | 'updatePending' | 'rejected'
  // e.g. 'drag', 'keyboard', 'remote', 'undo'
  origin?: unknown
  // transaction id for batching / rollback
  transactionId?: string
  // Braid-like version metadata
  version?: string | string[]
  parents?: string[]
  // e.g. 'merge', 'replace', 'ot', 'crdt'
  mergeType?: string
}

// A Braid-aligned patch.
// `unit` is the patch type / content type (e.g. 'json', 'json-patch', 'text',
// 'ot-text-unicode', 'nodes').
// `range` is the path or range to write (empty string means the whole value).
// `content` is the new value or, for OT, the operation.
export interface Patch<T = unknown> {
  unit: 'json' | 'json-patch' | 'text' | 'ot-text-unicode' | 'nodes'
  range: string
  content: T
  context: PatchContext
}
