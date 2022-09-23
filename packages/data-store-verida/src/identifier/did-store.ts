import { FindArgs, IIdentifier, TIdentifiersColumns } from '@veramo/core'
import { AbstractDIDStore } from '@veramo/did-manager'

import Debug from 'debug'
import { DiffCallback, VeramoJsonCache, VeramoJsonStore } from '../types'
import { serialize, deserialize } from '@ungap/structured-clone'
import { MockAgent } from '../data-store'

const debug = Debug('veramo:data-store-json:did-store')

/**
 * An implementation of {@link @veramo/did-manager#AbstractDIDStore | AbstractDIDStore} that uses a JSON object to
 * store the relationships between DIDs, their providers and controllers and their keys and services as they are known
 * and managed by a Veramo agent.
 *
 * An instance of this class can be used by {@link @veramo/did-manager#DIDManager} as the data storage layer.
 *
 * This class must be initialized with a {@link VeramoJsonStore}, which serves as the JSON object storing data in
 * memory as well as providing an update notification callback to persist this data.
 * For correct usage, this MUST use the same {@link VeramoJsonStore} instance as the one used by
 * {@link @veramo/key-manager#KeyManager | KeyManager}.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class DIDStore extends AbstractDIDStore {
  private agent: MockAgent

  constructor(agent: MockAgent) {
    super()
    this.agent = agent
  }

  async get({
              did,
              alias,
              provider,
            }: {
    did?: string
    alias?: string
    provider?: string
  }): Promise<IIdentifier> {
    let where: { did?: string; alias?: string; provider?: string } = {}

    if (did !== undefined && alias === undefined) {
      where = { did }
    } else if (did === undefined && alias !== undefined && provider !== undefined) {
      where = { alias, provider }
    } else {
      throw Error('invalid_arguments: DidStoreJson.get requires did or (alias and provider)')
    }

    let identifier: IIdentifier | undefined
    const identifiers = await this.agent.getDataStoreAdapter('dids')

    if (where.did) {
      identifier = <IIdentifier> await identifiers.get(where.did)
    } else {
      const query = <FindArgs<TIdentifiersColumns>> {
        where: [{
          column: 'provider',
          value: [where.provider!]
          op: 'Equal'
        }, {
          column: 'alias',
          value: [where.alias!]
          op: 'Equal'
        }]
      }

      const results = <IIdentifier[]> await identifiers.getMany(query)
      if (results && results.length) {
        identifier = results[0]
      }

      /*identifier = Object.values(this.cacheTree.dids).find(
        (iid: IIdentifier) => iid.provider === where.provider && iid.alias === where.alias,
      )*/
    }

    if (!identifier) throw Error('Identifier not found')

    return deserialize(serialize(identifier))
  }

  async delete({ did }: { did: string }) {
    const identifiers = await this.agent.getDataStoreAdapter('dids')
    return await identifiers.delete(did)

    /*
    if (this.cacheTree.dids[did]) {
      const oldTree = deserialize(serialize(this.cacheTree, { lossy: true }))
      delete this.cacheTree.dids[did]
      // FIXME: delete key associations?
      await this.notifyUpdate(oldTree, this.cacheTree)
      return true
    }
    return false*/
  }

  async import(args: IIdentifier) {
    throw new Error("Import not supported")
    /*
    const oldTree = deserialize(serialize(this.cacheTree, { lossy: true }))
    this.cacheTree.dids[args.did] = args
    args.keys.forEach((key) => {
      this.cacheTree.keys[key.kid] = {
        ...key,
        // FIXME: keys should be able to associate with multiple DIDs
        meta: { ...key.meta, did: args.did },
      }
    })

    await this.notifyUpdate(oldTree, this.cacheTree)
    return true
    */
  }

  async list(args: { alias?: string; provider?: string }): Promise<IIdentifier[]> {
    /*
    const result = Object.values(this.cacheTree.dids).filter(
      (iid: IIdentifier) =>
        (!args.provider || (args.provider && iid.provider === args.provider)) &&
        (!args.alias || (args.alias && iid.alias === args.alias)),
    )
    */

    const where = []
    if (args.alias) {
      where.push({
        column: 'alias',
        value: [args.alias!],
        op: 'Equal'
      })
    }

    if (args.provider) {
      where.push({
        column: 'provider',
        value: [args.provider!],
        op: 'Equal'
      })
    }

    const dids = await this.agent.getDataStoreAdapter('dids')
    const results = <IIdentifier[]> await dids.getMany(<FindArgs<TIdentifiersColumns>> {
      where
    })

    const result = results.reduce((result: any, item: IIdentifier) => {
      result[item.did] = item
      return result
    }, {})

    return deserialize(serialize(result))
  }
}
