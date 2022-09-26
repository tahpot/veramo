import {
  AuthorizedDIDContext,
  FindArgs,
  IAgentPlugin,
  ICreateVerifiableCredentialArgs,
  IDataStore,
  IDataStoreDeleteVerifiableCredentialArgs,
  IDataStoreGetMessageArgs,
  IDataStoreGetVerifiableCredentialArgs,
  IDataStoreGetVerifiablePresentationArgs,
  IDataStoreORM,
  IDataStoreSaveMessageArgs,
  IDataStoreSaveVerifiableCredentialArgs,
  IDataStoreSaveVerifiablePresentationArgs,
  IIdentifier,
  IMessage,
  schema,
  TClaimsColumns,
  TCredentialColumns,
  TIdentifiersColumns,
  TMessageColumns,
  TPresentationColumns,
  UniqueVerifiableCredential,
  UniqueVerifiablePresentation,
  VerifiableCredential,
  VerifiablePresentation,
  Order,
  Where
} from '@veramo/core'
import { asArray, computeEntryHash, extractIssuer } from '@veramo/utils'
import { serialize, deserialize } from '@ungap/structured-clone'
import {
  ClaimTableEntry,
  CredentialTableEntry,
  PresentationTableEntry,
} from './types'
import { normalizeCredential } from 'did-jwt-vc'
import { Context, Database } from '@verida/client-ts'

/**
 * A generic data store adapter that must implement the ability to insert, update, delete and query
 * a data store.
 * 
 * In theory the existing TypeORM could be mapped to this basic interface.
 * 
 * I alternatively explored mapping Verida to TypeORM, but that was non-trivial.
 */
export interface IDataStoreAdapter {

  /**
   * 
   * @param jsonData Data to be saved
   */
  save(id: string, jsonData: Record<any, any>): Promise<boolean>

  saveIfNotExist(id: string, jsonData: Record<any, any>): Promise<boolean>

  get(id: string): Promise<object | undefined>

  delete(id: string): Promise<boolean>

  getMany(args?: FindArgs<PossibleColumns>): Promise<object[]>

}

/**
 * A Verida specific implementation of the DataStoreAdapter Interface
 */
export class VeridaDataStoreAdapter implements IDataStoreAdapter {

  private database: Database
  constructor(database: Database) {
    this.database = database
  }

  public async save(id: string, jsonData: Record<any, any>): Promise<boolean> {
    jsonData._id = id
    try {
      return await this.database.save(jsonData)
    } catch (err) {
      if (err.name == 'conflict') {
        // record existed
        return false
      }

      // unknown error (log somewhere?)
      console.error(err)
      return false
    }
  }

  public async saveIfNotExist(id: string, jsonData: Record<any, any>): Promise<boolean> {
    jsonData._id = id
    
    try {
      await this.get(id)
    } catch (err: any) {
      if (err.name == 'not_found') {
        await this.database.save(jsonData)
        return true
      }

      throw err
    }

    return false
  }

  public async get(id: string): Promise<object | undefined> {
    return await this.database.get(id)
  }

  public async delete(id: string): Promise<boolean> {
    return await this.database.delete(id)
  }

  /**
   * @todo: I need some clarification of the exact logic of some of these operators
   * 
   * @todo: Requires solid tests
   * 
   * @param args 
   * @returns 
   */
  public async getMany(args?: FindArgs<PossibleColumns>): Promise<object[]> {
    const options: any = {}

    // built the query filter
    const filter: any = {}
    args?.where?.forEach((item: Where<PossibleColumns>) => {
      let param = item.not ? '$n' : '$'
      switch (item.op) {
        case 'LessThan':
          param += 'lt'
          break
        case 'LessThan':
          param += 'lte'
          break
        case 'MoreThan':
          param += 'gt'
          break
        case 'MoreThanOrEqual':
          param += 'gte'
          break
        case 'Equal':
          param += 'eq'
          break
        case 'Like':
          // @todo: What is logic? Use regex?
          param += 'like'
          break
        case 'Between':
          // @todo: What is logic? gte or gt?
          param += 'between'
          break
        case 'In':
          param += 'in'
          break
        case 'Any':
          // @todo: What is logic?
          param += 'any'
          break
        case 'IsNull':
          // @todo
          param += 'empty'
          break
      }

      const entry: any = {}
      entry[param] = item.value

      filter[item.column] = entry
    })

    // handle result order
    if (args!.order) {
      const order: any = {}
      args!.order.forEach((item: Order<PossibleColumns>) => {
        order[item.column] = item.direction == 'ASC' ? 1 : -1
      })

      options.order = order
    }

    // limit results
    if (args?.take) {
      options.limit = args.take
    }

    // skip results
    // @todo: test this
    if (args?.skip) {
      options.offset = args.skip
    }

    return await this.database.getMany(filter, options)
  }
}

/**
 * A Singleton Database Manager class that maintains open connections to any necessary databases.
 * 
 * This should be implemented as an Agent plugin.
 * 
 * It may be possible to refactor the Veramo storage so each plugin (DIDStore, KeyStore) etc accepts
 * a IDataStoreAdapter instance. However given the need for DataStore to generate data in different
 * databases, I suspect that may not work well?
 */
export class DbManager {

  private veridaContext: Context
  private dataAdapters?: Record<string, IDataStoreAdapter>

  /**
   * For now, accept a single verida storage context for all storage.
   * 
   * If this was integrated into `Agent`, this wouldn't be necessary as the
   * storage would be fetched from the respective module.
   * 
   * @param context 
   */
  constructor(context: Context) {
    this.veridaContext = context
  }

  private async init() {
    if (this.dataAdapters) {
      return
    }

    // Map Veramo datastore names to Verida database names
    this.dataAdapters = {
      dids: new VeridaDataStoreAdapter(await this.veridaContext.openDatabase('veramo_dids')),
      credentials: new VeridaDataStoreAdapter(await this.veridaContext.openDatabase('veramo_credentials')),
      presentations: new VeridaDataStoreAdapter(await this.veridaContext.openDatabase('veramo_presentations')),
      claims: new VeridaDataStoreAdapter(await this.veridaContext.openDatabase('veramo_claims')),
      messages: new VeridaDataStoreAdapter(await this.veridaContext.openDatabase('veramo_messages'))
    }
  }

  public async getDataStoreAdapter(type: 'dids' | 'credentials' | 'presentations' | 'claims' | 'messages' | 'keys' | 'privateKeys') {
    await this.init()

    switch (type) {
      case 'dids':
        // In the future this could be something like
        // return this.getDIDStore().getStorageEngine()
        return await this.dataAdapters!.dids
      default:
        return await this.dataAdapters![type]
    }
  }
}

/**
 * A Veramo agent storage plugin that implements the {@link @veramo/core#IDataStore | IDataStore} and
 * {@link @veramo/core#IDataStoreORM | IDataStoreORM} methods using approriate decentralized Verida databases.
 *
 * This plugin must be initialized with a Verida Context, that is connected and authenticated with the
 * Verida storage network.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export class DataStoreVerida implements IAgentPlugin {
  readonly methods: IDataStore & IDataStoreORM
  readonly schema = { ...schema.IDataStore, ...schema.IDataStoreORM }

  private dbManager: DbManager

  /**
   * @param context Context
   */
  constructor(context: Context) {
    this.dbManager = new DbManager(context)

    this.methods = {
      // IDataStore methods
      dataStoreSaveMessage: this.dataStoreSaveMessage.bind(this),
      dataStoreGetMessage: this.dataStoreGetMessage.bind(this),
      //dataStoreDeleteMessage: this.dataStoreDeleteMessage.bind(this),
      dataStoreSaveVerifiableCredential: this.dataStoreSaveVerifiableCredential.bind(this),
      dataStoreGetVerifiableCredential: this.dataStoreGetVerifiableCredential.bind(this),
      dataStoreDeleteVerifiableCredential: this.dataStoreDeleteVerifiableCredential.bind(this),
      dataStoreSaveVerifiablePresentation: this.dataStoreSaveVerifiablePresentation.bind(this),
      dataStoreGetVerifiablePresentation: this.dataStoreGetVerifiablePresentation.bind(this),
      //dataStoreDeleteVerifiablePresentation: this.dataStoreDeleteVerifiablePresentation.bind(this),

      // IDataStoreORM methods
      dataStoreORMGetIdentifiers: this.dataStoreORMGetIdentifiers.bind(this),
      dataStoreORMGetIdentifiersCount: this.dataStoreORMGetIdentifiersCount.bind(this),
      dataStoreORMGetMessages: this.dataStoreORMGetMessages.bind(this),
      dataStoreORMGetMessagesCount: this.dataStoreORMGetMessagesCount.bind(this),
      dataStoreORMGetVerifiableCredentialsByClaims:
        this.dataStoreORMGetVerifiableCredentialsByClaims.bind(this),
      dataStoreORMGetVerifiableCredentialsByClaimsCount:
        this.dataStoreORMGetVerifiableCredentialsByClaimsCount.bind(this),
      dataStoreORMGetVerifiableCredentials: this.dataStoreORMGetVerifiableCredentials.bind(this),
      dataStoreORMGetVerifiableCredentialsCount: this.dataStoreORMGetVerifiableCredentialsCount.bind(this),
      dataStoreORMGetVerifiablePresentations: this.dataStoreORMGetVerifiablePresentations.bind(this),
      dataStoreORMGetVerifiablePresentationsCount:
        this.dataStoreORMGetVerifiablePresentationsCount.bind(this),
    }
  }

  async dataStoreSaveMessage(args: IDataStoreSaveMessageArgs): Promise<string> {
    const id = args.message?.id || computeEntryHash(args.message)
    const message = { ...args.message, id }

    const messages = await this.dbManager.getDataStoreAdapter('messages')
    await messages.save(id, message)

    // TODO: deprecate automatic credential and presentation saving
    const credentials = asArray(message.credentials)
    const presentations = asArray(message.presentations)
    for (const verifiableCredential of credentials) {
      await this._dataStoreSaveVerifiableCredential({ verifiableCredential }, false)
    }
    for (const verifiablePresentation of presentations) {
      await this._dataStoreSaveVerifiablePresentation({ verifiablePresentation }, false)
    }

    // adding dummy DIDs is required to make `dataStoreORMGetIdentifiers` work
    const dids = await this.dbManager.getDataStoreAdapter('dids')
    if (message?.from) {
      await dids.saveIfNotExist(message.from, { did: message.from, provider: '', keys: [], services: [] })
    }

    asArray(message.to).forEach(async (did) => {
      await dids.saveIfNotExist(did, { did, provider: '', keys: [], services: [] })
    })

    return message.id
  }

  async dataStoreGetMessage(args: IDataStoreGetMessageArgs): Promise<IMessage> {
    const messages = await this.dbManager.getDataStoreAdapter('messages')
    const message = <IMessage> await messages.get(args.id)

    if (message) {
      return message
    } else {
      throw Error('Message not found')
    }
  }

  private async _dataStoreSaveVerifiableCredential(
    args: IDataStoreSaveVerifiableCredentialArgs,
    postUpdates: boolean = true,
  ): Promise<string> {
    const canonicalCredential =
      args?.verifiableCredential?.proof?.type === 'JwtProof2020' &&
      typeof args?.verifiableCredential?.proof?.jwt === 'string'
        ? args?.verifiableCredential?.proof?.jwt
        : args.verifiableCredential
    const vc = args.verifiableCredential
    const id = vc.id
    const hash = computeEntryHash(canonicalCredential)
    const issuer = extractIssuer(vc)
    const subject = vc.credentialSubject.id
    const context = asArray(vc['@context'])
    const type = asArray(vc.type)
    let issuanceDate: Date | undefined = undefined
    let expirationDate: Date | undefined = undefined

    if (vc.issuanceDate) {
      issuanceDate = new Date(vc.issuanceDate)
    }
    if (vc.expirationDate) {
      expirationDate = new Date(vc.expirationDate)
    }

    const credential: CredentialTableEntry = {
      hash,
      id,
      parsedCredential: vc,
      canonicalCredential,
      issuer,
      subject,
      issuanceDate,
      expirationDate,
      context,
      type,
    }

    const claims: ClaimTableEntry[] = []

    for (const claimType in vc.credentialSubject) {
      if (vc.credentialSubject.hasOwnProperty(claimType)) {
        const value = vc.credentialSubject[claimType]
        if (claimType !== 'id') {
          const claim = {
            hash: computeEntryHash(hash + claimType),
            type: claimType,
            value,
            issuer,
            subject,
            issuanceDate,
            expirationDate,
            context: context,
            credentialType: type,
            credentialHash: hash,
          }
          claims.push(claim)
        }
      }
    }

    const credentials = await this.dbManager.getDataStoreAdapter('credentials')
    await credentials.save(hash, credential)

    const claimsDb = await this.dbManager.getDataStoreAdapter('claims')
    for (const claim of claims) {
      await claimsDb.save(claim.hash, claim)
    }

    // adding dummy DIDs is required to make `dataStoreORMGetIdentifiers` work
    const dids = await this.dbManager.getDataStoreAdapter('dids')
    if (issuer) {
      await dids.saveIfNotExist(issuer, { did: issuer, provider: '', keys: [], services: [] })
    }
    if (subject) {
      await dids.saveIfNotExist(subject, { did: subject, provider: '', keys: [], services: [] })
    }
    return credential.hash
  }

  async dataStoreSaveVerifiableCredential(args: IDataStoreSaveVerifiableCredentialArgs): Promise<string> {
    return this._dataStoreSaveVerifiableCredential(args)
  }

  async dataStoreDeleteVerifiableCredential(
    args: IDataStoreDeleteVerifiableCredentialArgs,
  ): Promise<boolean> {
    const credentials = await this.dbManager.getDataStoreAdapter('credentials')

    const credential = await credentials.get(args.hash)
    if (credential) {
      // @todo: Delete all the claims associated with a given credential hash
      /*
      const claims = Object.values(this.cacheTree.claims)
        .filter((claim) => claim.credentialHash === credential.hash)
        .map((claim) => claim.hash)
      const oldTree = deserialize(serialize(this.cacheTree, { lossy: true }))
      delete this.cacheTree.credentials[args.hash]
      for (const claimHash of claims) {
        delete this.cacheTree.claims[claimHash]
      }
      await this.notifyUpdate(oldTree, this.cacheTree)
      */
      return true
    }
    return false
  }

  async dataStoreGetVerifiableCredential(
    args: IDataStoreGetVerifiableCredentialArgs,
  ): Promise<VerifiableCredential> {
    const credentials = await this.dbManager.getDataStoreAdapter('credentials')
    const credentialEntity = <CredentialTableEntry> await credentials.get(args.hash)
    if (credentialEntity) {
      const { parsedCredential } = credentialEntity
      return deserialize(serialize(parsedCredential))
    } else {
      throw Error('Verifiable credential not found')
    }
  }

  private async _dataStoreSaveVerifiablePresentation(
    args: IDataStoreSaveVerifiablePresentationArgs,
    postUpdates: boolean = true,
  ): Promise<string> {
    const vp = args.verifiablePresentation
    const canonicalPresentation =
      vp?.proof?.type === 'JwtProof2020' && typeof vp?.proof?.jwt === 'string' ? vp?.proof?.jwt : vp

    const id = vp.id
    const hash = computeEntryHash(canonicalPresentation)
    const holder = extractIssuer(vp)
    const verifier = asArray(vp.verifier)
    const context = asArray(vp['@context'])
    const type = asArray(vp.type)
    let issuanceDate: Date | undefined = undefined
    let expirationDate: Date | undefined = undefined

    if (vp.issuanceDate) {
      issuanceDate = new Date(vp.issuanceDate)
    }
    if (vp.expirationDate) {
      expirationDate = new Date(vp.expirationDate)
    }

    const credentials: VerifiableCredential[] = asArray(vp.verifiableCredential).map((cred) => {
      if (typeof cred === 'string') {
        return normalizeCredential(cred)
      } else {
        return <VerifiableCredential>cred
      }
    })

    const presentation: PresentationTableEntry = {
      hash,
      id,
      parsedPresentation: vp,
      canonicalPresentation,
      holder,
      verifier,
      issuanceDate,
      expirationDate,
      context,
      type,
      credentials,
    }

    const presentations = await this.dbManager.getDataStoreAdapter('presentations')
    await presentations.save(hash, presentation)

    for (const verifiableCredential of credentials) {
      await this._dataStoreSaveVerifiableCredential({ verifiableCredential }, false)
    }

    // adding dummy DIDs is required to make `dataStoreORMGetIdentifiers` work
    const dids = await this.dbManager.getDataStoreAdapter('dids')
    if (holder) {
      await dids.saveIfNotExist(holder, { did: holder, provider: '', keys: [], services: [] })
    }
    asArray(verifier).forEach(async (did) => {
      await dids.saveIfNotExist(did, { did, provider: '', keys: [], services: [] })
    })
    return hash
  }

  async dataStoreSaveVerifiablePresentation(args: IDataStoreSaveVerifiablePresentationArgs): Promise<string> {
    return this._dataStoreSaveVerifiablePresentation(args)
  }

  async dataStoreGetVerifiablePresentation(
    args: IDataStoreGetVerifiablePresentationArgs,
  ): Promise<VerifiablePresentation> {
    const presentations = await this.dbManager.getDataStoreAdapter('presentations')
    const presentationEntry = <PresentationTableEntry> await presentations.get(args.hash)
    if (presentationEntry) {
      const { parsedPresentation } = presentationEntry
      return parsedPresentation
    } else {
      throw Error('Verifiable presentation not found')
    }
  }

  async dataStoreORMGetIdentifiers(
    args: FindArgs<TIdentifiersColumns>,
    context: AuthorizedDIDContext,
  ): Promise<IIdentifier[]> {
    if (args?.where) {
      args.where = []
    }

    args.where?.push({
      column: 'did',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const dids = await this.dbManager.getDataStoreAdapter('dids')
    const identifiers = <IIdentifier[]> await dids.getMany(args)

    /*const identifiers = buildQuery(Object.values(this.cacheTree.dids), args, ['did'], context.authorizedDID)
    // FIXME: collect corresponding keys from `this.cacheTree.keys`?
    */
    return deserialize(serialize(identifiers))
  }

  async dataStoreORMGetIdentifiersCount(
    args: FindArgs<TIdentifiersColumns>,
    context: AuthorizedDIDContext,
  ): Promise<number> {
    // @todo: make more efficient?
    return (await this.dataStoreORMGetIdentifiers(args, context)).length
  }

  async dataStoreORMGetMessages(
    args: FindArgs<TMessageColumns>,
    context: AuthorizedDIDContext,
  ): Promise<IMessage[]> {
    // Fetch messages that match either `to` or `from`.
    // Unable to do two queries as the `FindArgs` only supports `AND` in the `WHERE` clause
    if (args?.where) {
      args.where = []
    }

    args.where?.push({
      column: 'to',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const dids = await this.dbManager.getDataStoreAdapter('dids')
    const toMessages = <IMessage[]> await dids.getMany(args)

    args.where?.pop()
    args.where?.push({
      column: 'from',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const fromMessages = <IMessage[]> await dids.getMany(args)
    const messages = fromMessages.concat(toMessages)

    /*
    const messages = buildQuery(
      Object.values(this.cacheTree.messages),
      args,
      ['to', 'from'],
      context.authorizedDID,
    )*/
    return deserialize(serialize(messages))
  }

  async dataStoreORMGetMessagesCount(
    args: FindArgs<TMessageColumns>,
    context: AuthorizedDIDContext,
  ): Promise<number> {
    return (await this.dataStoreORMGetMessages(args, context)).length
  }

  async dataStoreORMGetVerifiableCredentialsByClaims(
    args: FindArgs<TClaimsColumns>,
    context: AuthorizedDIDContext,
  ): Promise<Array<UniqueVerifiableCredential>> {
    // Fetch messages that match either `issuer` or `subject`.
    // Unable to do two queries as the `FindArgs` only supports `AND` in the `WHERE` clause
    if (args?.where) {
      args.where = []
    }

    args.where?.push({
      column: 'issuer',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const claims = await this.dbManager.getDataStoreAdapter('claims')
    const issuerClaims = <ClaimTableEntry[]> await claims.getMany(args)

    args.where?.pop()
    args.where?.push({
      column: 'subject',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const subjectClaims = <ClaimTableEntry[]> await claims.getMany(args)
    const filteredClaims = subjectClaims.concat(issuerClaims)


    /*const filteredClaims = buildQuery(
      Object.values(this.cacheTree.claims),
      args,
      ['issuer', 'subject'],
      context.authorizedDID,
    )*/

    let filteredCredentials = new Set<CredentialTableEntry>()
    const credentials = await this.dbManager.getDataStoreAdapter('credentials')
    filteredClaims.forEach(async (claim) => {
      const credential = <CredentialTableEntry> await credentials.get(claim.credentialHash)
      filteredCredentials.add(credential)
    })

    return deserialize(serialize(
      Array.from(filteredCredentials).map((cred) => {
        const { hash, parsedCredential } = cred
        return {
          hash,
          verifiableCredential: parsedCredential,
        }
      }),
    ))
  }

  async dataStoreORMGetVerifiableCredentialsByClaimsCount(
    args: FindArgs<TClaimsColumns>,
    context: AuthorizedDIDContext,
  ): Promise<number> {
    return (await this.dataStoreORMGetVerifiableCredentialsByClaims(args, context)).length
  }

  async dataStoreORMGetVerifiableCredentials(
    args: FindArgs<TCredentialColumns>,
    context: AuthorizedDIDContext,
  ): Promise<Array<UniqueVerifiableCredential>> {
    // Fetch verifiable credentials that match either `issuer` or `subject`.
    // Unable to do two queries as the `FindArgs` only supports `AND` in the `WHERE` clause
    if (args?.where) {
      args.where = []
    }

    args.where?.push({
      column: 'issuer',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const credentialsDb = await this.dbManager.getDataStoreAdapter('credentials')
    const issuerCredentials = <CredentialTableEntry[]> await credentialsDb.getMany(args)

    args.where?.pop()
    args.where?.push({
      column: 'subject',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const subjectCredentials = <CredentialTableEntry[]> await credentialsDb.getMany(args)
    const credentials = subjectCredentials.concat(issuerCredentials)
    /*
    const credentials = buildQuery(
      Object.values(this.cacheTree.credentials),
      args,
      ['issuer', 'subject'],
      context.authorizedDID,
    )
    */

    return deserialize(serialize(
      credentials.map((cred: any) => {
        const { hash, parsedCredential } = cred
        return {
          hash,
          verifiableCredential: parsedCredential,
        }
      }),
    ))
  }

  async dataStoreORMGetVerifiableCredentialsCount(
    args: FindArgs<TCredentialColumns>,
    context: AuthorizedDIDContext,
  ): Promise<number> {
    return (await this.dataStoreORMGetVerifiableCredentials(args, context)).length
  }

  async dataStoreORMGetVerifiablePresentations(
    args: FindArgs<TPresentationColumns>,
    context: AuthorizedDIDContext,
  ): Promise<Array<UniqueVerifiablePresentation>> {
    // Fetch verifiable presentations that match either `holder` or `verifier`.
    // Unable to do two queries as the `FindArgs` only supports `AND` in the `WHERE` clause
    if (args?.where) {
      args.where = []
    }

    args.where?.push({
      column: 'holder',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const presentationsDb = await this.dbManager.getDataStoreAdapter('presentations')
    const holderPresentations = <PresentationTableEntry[]> await presentationsDb.getMany(args)

    args.where?.pop()
    args.where?.push({
      column: 'verifier',
      value: [context.authorizedDID!],
      op: 'Equal'
    })

    const verifierPresentations = <PresentationTableEntry[]> await presentationsDb.getMany(args)
    const presentations = verifierPresentations.concat(holderPresentations)

    /*
    const presentations = buildQuery(
      Object.values(this.cacheTree.presentations),
      args,
      ['holder', 'verifier'],
      context.authorizedDID,
    )
    */

    return deserialize(serialize(
      presentations.map((pres: any) => {
        const { hash, parsedPresentation } = pres
        return {
          hash,
          verifiablePresentation: parsedPresentation,
        }
      }),
    ))
  }

  async dataStoreORMGetVerifiablePresentationsCount(
    args: FindArgs<TPresentationColumns>,
    context: AuthorizedDIDContext,
  ): Promise<number> {
    return (await this.dataStoreORMGetVerifiablePresentations(args, context)).length
  }
}

/*
function buildFilter<T extends Partial<Record<PossibleColumns, any>>>(
  target: T,
  input: FindArgs<PossibleColumns>,
): boolean {
  let condition = true
  if (input?.where) {
    for (const item of input.where) {
      let newCondition: boolean
      const targetValue = (target as any)[item.column]
      switch (item.op) {
        case 'Between':
          if (item.value?.length != 2) throw Error('Operation Between requires two values')
          newCondition = item.value[0] <= targetValue && targetValue <= item.value[1]
          break
        case 'Equal':
          if (item.value?.length != 1) throw Error('Operation Equal requires one value')
          newCondition = item.value[0] === targetValue
          if (Array.isArray(targetValue)) {
            // mimicking legacy SQL data-store behavior where array values are stored as joined strings
            newCondition ||= targetValue.join(',').includes(item.value[0])
          }
          break
        case 'IsNull':
          newCondition = targetValue === null || typeof targetValue === 'undefined'
          break
        case 'LessThan':
          if (item.value?.length != 1) throw Error('Operation LessThan requires one value')
          newCondition = targetValue < item.value
          break
        case 'LessThanOrEqual':
          if (item.value?.length != 1) throw Error('Operation LessThanOrEqual requires one value')
          newCondition = targetValue <= item.value
          break
        case 'Like':
          if (item.value?.length != 1) throw Error('Operation Like requires one value')
          // FIXME: add support for escaping
          const likeExpression = `^${(item.value?.[0] || '').replace(/_/g, '.').replace(/%/g, '.*')}$`
          newCondition = new RegExp(likeExpression).test(targetValue)
          break
        case 'MoreThan':
          if (item.value?.length != 1) throw Error('Operation MoreThan requires one value')
          newCondition = targetValue > item.value
          break
        case 'MoreThanOrEqual':
          if (item.value?.length != 1) throw Error('Operation MoreThanOrEqual requires one value')
          newCondition = targetValue >= item.value
          break
        case 'Any':
        case 'In':
        default:
          if (!Array.isArray(item.value)) throw Error('Operator Any requires value to be an array')

          if (Array.isArray(targetValue)) {
            newCondition = item.value.find((val) => targetValue.includes(val)) !== undefined
            // mimicking legacy SQL data-store behavior where array values are stored as joined strings
            newCondition ||= targetValue.join(',').includes(item.value.join(','))
          } else {
            newCondition = item.value.includes(targetValue)
          }
          break
      }
      if (item.not === true) {
        newCondition = !newCondition
      }
      condition &&= newCondition
    }
  }
  return condition
}
*/

type PossibleColumns =
  | TMessageColumns
  | TClaimsColumns
  | TCredentialColumns
  | TPresentationColumns
  | TIdentifiersColumns

/*function buildQuery<T extends Partial<Record<PossibleColumns, any>>>(
  targetCollection: T[],
  input: FindArgs<PossibleColumns>,
  authFilterColumns: string[],
  authFilterValue?: string,
): T[] {
  let filteredCollection = targetCollection.filter((target) => buildFilter(target, input))
  if (authFilterValue) {
    filteredCollection = filteredCollection.filter((target) => {
      let columnValues: string[] = []
      for (const column of authFilterColumns) {
        columnValues = [...columnValues, ...asArray((target as any)[column])]
      }
      return columnValues.includes(authFilterValue)
    })
  }
  if (input.skip) {
    filteredCollection = filteredCollection.slice(input.skip)
  }
  if (input.take) {
    filteredCollection = filteredCollection.slice(0, input.take)
  }
  if (input.order && input.order.length > 0) {
    filteredCollection.sort((a: T, b: T) => {
      let result = 0
      let orderIndex = 0
      while (result == 0 && input.order?.[orderIndex]) {
        const direction = input.order?.[orderIndex].direction === 'DESC' ? -1 : 1
        const col: PossibleColumns = input.order?.[orderIndex]?.column
        if (!col) {
          break
        }
        const colA = a[col]
        const colB = b[col]
        if (typeof colA?.localeCompare === 'function') {
          result = direction * colA.localeCompare(colB)
        } else {
          result = direction * (colA - colB || 0)
        }
        orderIndex++
      }
      return result
    })
  }
  return filteredCollection
}
*/