import { IKey, ManagedKeyInfo } from '@veramo/core'
import { AbstractKeyStore } from '@veramo/key-manager'

import Debug from 'debug'
import { serialize, deserialize } from '@ungap/structured-clone'
import { DbManager } from '../data-store'

const debug = Debug('veramo:data-store-json:key-store')

/**
 * An implementation of {@link @veramo/key-manager#AbstractKeyStore | AbstractKeyStore} that uses a JSON object to
 * store the relationships between keys, their IDs, aliases and
 * {@link @veramo/key-manager#AbstractKeyManagementSystem | KMS implementations}, as they are known and managed by a
 * Veramo agent.
 *
 * An instance of this class can be used by {@link @veramo/key-manager#KeyManager} as the data storage layer.
 *
 * This class must be initialized with a {@link VeramoJsonStore}, which serves as the JSON object storing data in
 * memory as well as providing an update notification callback to persist this data.
 * For correct usage, this MUST use the same {@link VeramoJsonStore} instance as the one used by
 * {@link @veramo/did-manager#DIDManager | DIDManager}.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class KeyStore extends AbstractKeyStore {
  private dbManager: DbManager

  /**
   * @param jsonStore - Serves as the JSON object storing data in memory as well as providing an update notification
   *   callback to persist this data. For correct usage, this MUST use the same {@link VeramoJsonStore} instance as the
   *   one used by {@link @veramo/did-manager#DIDManager | DIDManager}.
   */
  constructor(dbManager: DbManager) {
    super()
    this.dbManager = dbManager
  }

  public async getDb() {
    return await this.dbManager.getDataStoreAdapter('keys')
  }

  async get({ kid }: { kid: string }): Promise<IKey> {
    const db = await this.getDb()
    const result = await db.get(kid)

    if (!result) {
      throw Error('not_found: Key not found')
    }

    return <IKey> result
  }

  async delete({ kid }: { kid: string }) {
    const db = await this.getDb()
    return await db.delete(kid)
  }

  async import(args: IKey): Promise<boolean> {
    throw new Error('not_supported: Import not supported')
  }

  async list(args: {} = {}): Promise<ManagedKeyInfo[]> {
    const db = await this.getDb()
    const dbKeys = <IKey[]> await db.getMany()

    const keys = Object.values(dbKeys).map((key: IKey) => {
      const { kid, publicKeyHex, type, meta, kms } = key
      return { kid, publicKeyHex, type, meta: deserialize(serialize(meta)), kms } as ManagedKeyInfo
    })
    return keys
  }
}
