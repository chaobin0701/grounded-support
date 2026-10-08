import type { DatabaseService } from '../database.service';
import type { AppConfigService } from '../config/config.service';
import { SecretBox } from '../security/secret-box';
import { embeddingFingerprint, embeddingProfileSchema, embedWithProfile, validateProfileEndpoint, type EmbeddingProfile } from './profile-embedding';

type QuerySource = Pick<DatabaseService, 'query'>;

/** Snapshots freeze the vector space, not credentials. Key rotation is read
 * from the same profile on every call and never changes the stored vectors. */
export async function resolveEmbeddingCredential(database: QuerySource, runtime: AppConfigService, profile: EmbeddingProfile): Promise<{ apiKey: string }> {
  if (!profile.profileId) {
    validateProfileEndpoint(profile, runtime);
    const connection = profile.secretRef === 'default' ? runtime.embedding : runtime.embedding.connections?.[profile.secretRef];
    if (!connection?.apiKey) throw new Error('Embedding credential is not configured');
    return { apiKey: connection.apiKey };
  }
  const row = (await database.query<{ config: unknown; api_key_ciphertext: string | null }>(
    'SELECT config,api_key_ciphertext FROM embedding_profiles WHERE id=$1', [profile.profileId])).rows[0];
  if (!row) throw new Error('Embedding profile is unavailable');
  const current = embeddingProfileSchema.parse(row.config);
  if (embeddingFingerprint(current) !== embeddingFingerprint(profile)
    || (profile.fingerprint && profile.fingerprint !== embeddingFingerprint(profile))) throw new Error('Embedding vector space changed; rebuild the index');
  if (row.api_key_ciphertext) return { apiKey: new SecretBox(runtime).decrypt(row.api_key_ciphertext) };
  validateProfileEndpoint(profile, runtime);
  const connection = profile.secretRef === 'default' ? runtime.embedding : runtime.embedding.connections?.[profile.secretRef];
  if (!connection?.apiKey) throw new Error('Embedding credential is not configured');
  return { apiKey: connection.apiKey };
}

export async function embedForProfile(database: QuerySource, runtime: AppConfigService, profile: EmbeddingProfile, inputs: string[]) {
  const credential = await resolveEmbeddingCredential(database, runtime, profile);
  return embedWithProfile(profile, inputs, runtime, credential);
}
