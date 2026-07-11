import { adapterRegistry } from '@hotbook/core'
import { bireactiveValueStore } from './adapters/bireactive-value-store'

// Register the bireactive adapter with the core registry.
// This runs on module load, making 'bireactive' available to the viewer.
adapterRegistry.set('bireactive', {
  key: 'bireactive',
  create: bireactiveValueStore,
})
