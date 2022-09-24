/**
 * {@link @veramo/core#Agent} {@link @veramo/data-store-json#DataStoreJson | plugin} that implements
 * {@link @veramo/core#IDataStore } and
 * {@link @veramo/core#IDataStoreORM }interfaces and uses a JSON tree as a backend.
 *
 * The JSON tree backend can be persisted to any JSON compatible media using a callback that gets called when the agent
 * data is updated.
 *
 * @packageDocumentation
 */

export { DataStoreVerida } from './data-store'
export {
  ClaimTableEntry,
  CredentialTableEntry,
  PresentationTableEntry,
} from './types'
export { DIDStore } from './identifier/did-store'
export { KeyStore } from './identifier/key-store'
export { PrivateKeyStore } from './identifier/private-key-store'
