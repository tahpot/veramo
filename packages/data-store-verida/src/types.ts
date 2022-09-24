import {
  VerifiableCredential,
  VerifiablePresentation,
  W3CVerifiableCredential,
  W3CVerifiablePresentation,
} from '@veramo/core'

/**
 * This is used internally by {@link @veramo/data-store-json#DataStoreJson | DataStoreJson} to represent a Verifiable
 * Credential in a way that facilitates querying using the {@link @veramo/core#IDataStoreORM} interface.
 *
 * @beta This API may change in future versions without a BREAKING CHANGE notice.
 */
export interface CredentialTableEntry {
  hash: string
  issuer: string
  subject?: string
  id?: string
  issuanceDate?: Date
  expirationDate?: Date
  context: string[]
  type: string[]
  parsedCredential: VerifiableCredential
  canonicalCredential: W3CVerifiableCredential
}

/**
 * This is used internally by {@link @veramo/data-store-json#DataStoreJson | DataStoreJson} to represent the claims
 * contained in a Verifiable Credential in a way that facilitates querying using the {@link @veramo/core#IDataStoreORM}
 * interface.
 *
 * @beta This API may change in future versions without a BREAKING CHANGE notice.
 */
export interface ClaimTableEntry {
  hash: string
  issuer: string
  subject?: string
  credentialHash: string
  issuanceDate?: Date
  expirationDate?: Date
  context: string[]
  credentialType: string[]
  type: string
  value: any
}

/**
 * This is used internally by {@link @veramo/data-store-json#DataStoreJson | DataStoreJson} to represent a Verifiable
 * Presentation in a way that facilitates querying using the {@link @veramo/core#IDataStoreORM} interface.
 *
 * @beta This API may change in future versions without a BREAKING CHANGE notice.
 */
export interface PresentationTableEntry {
  hash: string
  holder: string
  verifier: string[]
  parsedPresentation: VerifiablePresentation
  canonicalPresentation: W3CVerifiablePresentation
  id?: String
  issuanceDate?: Date
  expirationDate?: Date
  context: string[]
  type: string[]
  credentials: VerifiableCredential[]
}