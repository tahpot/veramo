import { AbstractSecretBox, AbstractPrivateKeyStore } from '@veramo/key-manager'
import { ImportablePrivateKey, ManagedPrivateKey } from '@veramo/key-manager'
import { v4 as uuid4 } from 'uuid'
import Debug from 'debug'
import { serialize, deserialize } from '@ungap/structured-clone'
import { DbManager } from '../data-store'

const debug = Debug('veramo:data-store-json:private-key-store')

/**
 * An implementation of {@link @veramo/key-manager#AbstractPrivateKeyStore | AbstractPrivateKeyStore} that uses a JSON
 * object to store the private key material needed by {@link @veramo/kms-local#KeyManagementSystem |
 * KeyManagementSystem}.
 *
 * This class must be initialized with a {@link VeramoJsonStore}, which serves as the JSON object storing data in
 * memory as well as providing an update notification callback to persist this data.
 * The JSON object does not have to be shared with other users of {@link VeramoJsonStore}, but it can be.
 *
 * If an {@link @veramo/key-manager#AbstractSecretBox | AbstractSecretBox} is used, then key material is encrypted,
 * even in memory.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class PrivateKeyStore extends AbstractPrivateKeyStore {
  private dbManager: DbManager

  /**
   * @param context - 
   */
  constructor(dbManager: DbManager) {
    super()
    this.dbManager = dbManager
  }

  private async getDb() {
    return await this.dbManager.getDataStoreAdapter('privateKeys')
  }

  async get({ alias }: { alias: string }): Promise<ManagedPrivateKey> {
    const db = await this.getDb()
    const result = await db.get(alias)

    if (!result) {
      throw Error('not_found: PrivateKey not found')
    }

    return deserialize(serialize(result))
  }

  async delete({ alias }: { alias: string }) {
    debug(`Deleting private key data for alias=${alias}`)
    const db = await this.getDb()
    return await db.delete(alias)
  }

  async import(args: ImportablePrivateKey): Promise<ManagedPrivateKey> {
    throw new Error('not_supported: Import not supported')
  }

  async list(): Promise<Array<ManagedPrivateKey>> {
    const db = await this.getDb()
    const privateKeys = await db.getMany()
    return deserialize(serialize(Object.values(privateKeys!)))
  }
}
