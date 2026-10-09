import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders } from '../_shared/cors.ts';
import { handleUploadSession, reapVideoUploads, type CleanupEntry, type NewUploadMaterial, type R2MultipartUpload, type R2Part, type StoredObjectInfo, type UploadMaterial, type UploadSessionStore } from './core.ts';
import { r2AbortMultipartUpload, r2CreateMultipartUpload, r2CompleteMultipartUpload, r2DeleteObject, r2IssueCredentials, r2ListParts, selectR2Env } from '../_shared/r2.ts';

const BUCKET = 'course-materials';
const MATERIAL_FIELDS = 'id, course_id, academic_term_id, access_scope, uploaded_by, file_name, file_size, file_type, file_path, video_content_type, video_upload_key, video_upload_state, storage_provider';
const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'Server configuration is incomplete' }, 503);
  const adminClient = createClient(url, serviceKey);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const authorization = req.headers.get('Authorization');
  const internalReap = typeof body === 'object' && body !== null && !Array.isArray(body) &&
    (body as Record<string, unknown>).action === 'reap' &&
    authorization === `Bearer ${serviceKey}` && req.headers.get('apikey') === serviceKey;
  let user: { userId: string; profileId: string } | null = null;
  if (!internalReap) {
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(url, serviceKey, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
    const { data: profile, error: profileError } = await userClient
      .from('profiles').select('id, role').eq('user_id', auth.user.id).single();
    if (profileError || !profile || profile.role !== 'admin') return json({ error: 'Forbidden' }, 403);
    user = { userId: auth.user.id, profileId: profile.id };
  }

  const store: UploadSessionStore = {
    async courseExists(id: string): Promise<boolean> {
      const { data, error } = await adminClient.from('courses').select('id').eq('id', id).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async termExists(id: string): Promise<boolean> {
      const { data, error } = await adminClient.from('academic_terms').select('id').eq('id', id).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async findByKey(profileId: string, key: string): Promise<UploadMaterial | null> {
      const { data, error } = await adminClient.from('materials').select(MATERIAL_FIELDS)
        .eq('uploaded_by', profileId).eq('video_upload_key', key).maybeSingle();
      if (error) throw error;
      return data as UploadMaterial | null;
    },
    async findMaterial(id: string): Promise<UploadMaterial | null> {
      const { data, error } = await adminClient.from('materials').select(MATERIAL_FIELDS)
        .eq('id', id).maybeSingle();
      if (error) throw error;
      return data as UploadMaterial | null;
    },
    async createMaterial(material: NewUploadMaterial): Promise<UploadMaterial> {
      const { data, error } = await adminClient.from('materials').insert(material)
        .select(MATERIAL_FIELDS).single();
      if (error) throw error;
      return data as UploadMaterial;
    },
    async objectInfo(path: string): Promise<StoredObjectInfo | null> {
      const { data, error } = await adminClient.rpc('get_video_storage_object_info', { target_path: path });
      if (error) throw error;
      const info = data?.[0] as { size_bytes: number | string | null; content_type: string | null } | undefined;
      return info ? { size: Number(info.size_bytes), contentType: String(info.content_type ?? '') } : null;
    },
    async markUploaded(id: string): Promise<void> {
      const { data, error } = await adminClient.from('materials')
        .update({ video_upload_state: 'uploaded', processing_stage: 'transcribing', processing_progress: 10 })
        .eq('id', id).in('video_upload_state', ['uploading', 'uploaded'])
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Upload was cancelled or deleted during completion');
    },
    async markCancelled(id: string): Promise<void> {
      const { data, error } = await adminClient.from('materials')
        .update({ video_upload_state: 'cancelled', processing_stage: 'cancelled', processing_error: null })
        .eq('id', id).in('video_upload_state', ['uploading', 'cancelled'])
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Upload was completed or deleted during cancellation');
    },
    async markDeleting(id: string): Promise<void> {
      const { data, error } = await adminClient.from('materials')
        .update({ video_upload_state: 'deleting', processing_stage: 'deleting' })
        .eq('id', id).in('video_upload_state', ['uploading', 'uploaded', 'cancelled', 'deleting'])
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Video was already deleted');
    },
    async deleteMaterial(id: string): Promise<void> {
      const { error } = await adminClient.from('materials').delete().eq('id', id);
      if (error) throw error;
    },
    async deleteMaterialByPath(path: string): Promise<void> {
      const { error } = await adminClient.from('materials').delete()
        .eq('file_path', path).in('video_upload_state', ['cancelled', 'deleting']);
      if (error) throw error;
    },
    async recordCleanup(path: string, provider: 'supabase' | 'r2', r2UploadId?: string): Promise<void> {
      const { error } = await adminClient.from('video_storage_cleanup')
        .upsert({
          file_path: path,
          storage_provider: provider,
          object_key: provider === 'r2' ? path : null,
          r2_multipart_upload_id: r2UploadId ?? null,
          next_cleanup_at: new Date().toISOString(),
          last_error: null,
        }, { onConflict: 'file_path' });
      if (error) throw error;
    },
    async removeObject(path: string, provider: 'supabase' | 'r2'): Promise<void> {
      if (provider === 'r2') return r2DeleteObject(path);
      const { error } = await adminClient.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    },
    async enqueueTranscription(id: string): Promise<{ status: string }> {
      const { data, error } = await adminClient.functions.invoke('transcribe-video', { body: { materialId: id } });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      return { status: String(data?.status ?? 'pending') };
    },
    async transcriptionStatus(id: string): Promise<string> {
      const { data: material, error: materialError } = await adminClient.from('materials')
        .select('processing_status').eq('id', id).maybeSingle();
      if (materialError) throw materialError;
      if (material?.processing_status === 'failed') return 'failed';
      const { data: job, error: jobError } = await adminClient.from('video_transcription_jobs')
        .select('status').eq('material_id', id).maybeSingle();
      if (jobError) throw jobError;
      return String(job?.status ?? 'pending');
    },
    async staleUploads(before: string, limit: number): Promise<UploadMaterial[]> {
      const { data, error } = await adminClient.from('materials').select(MATERIAL_FIELDS)
        .eq('file_type', 'video').eq('video_upload_state', 'uploading')
        .lt('created_at', before).order('created_at', { ascending: true }).limit(limit);
      if (error) throw error;
      return data as UploadMaterial[];
    },
    async dueCleanup(before: string, limit: number): Promise<CleanupEntry[]> {
      const { data, error } = await adminClient.from('video_storage_cleanup')
        .select('file_path, created_at, storage_provider, object_key, r2_multipart_upload_id').lte('next_cleanup_at', before)
        .order('next_cleanup_at', { ascending: true }).limit(limit);
      if (error) throw error;
      return data as CleanupEntry[];
    },
    async deferCleanup(path: string, nextAt: string, errorMessage: string | null): Promise<void> {
      const { error } = await adminClient.from('video_storage_cleanup')
        .update({ next_cleanup_at: nextAt, last_error: errorMessage }).eq('file_path', path);
      if (error) throw error;
    },
    async finishCleanup(path: string): Promise<void> {
      const { error } = await adminClient.from('video_storage_cleanup').delete().eq('file_path', path);
      if (error) throw error;
    },
    async createR2MultipartUpload(filePath: string, contentType: string, fileSize: number): Promise<R2MultipartUpload> {
      return r2CreateMultipartUpload(filePath, contentType, fileSize);
    },
    async listR2Parts(objectKey: string, r2UploadId: string): Promise<R2Part[]> {
      return r2ListParts(objectKey, r2UploadId);
    },
    async completeR2MultipartUpload(objectKey: string, r2UploadId: string, parts: R2Part[]): Promise<{ size: number; contentType: string }> {
      return r2CompleteMultipartUpload(objectKey, r2UploadId, parts);
    },
    async abortR2MultipartUpload(objectKey: string, r2UploadId: string): Promise<void> {
      return r2AbortMultipartUpload(objectKey, r2UploadId);
    },
    async issueR2Credentials(objectKey: string, allowedActions: readonly string[]): Promise<Record<string, string>> {
      return r2IssueCredentials(objectKey, allowedActions, selectR2Env());
    },
    async saveMultipartUpload(id: string, upload: R2MultipartUpload): Promise<void> {
      const { error } = await adminClient.from('materials_multipart_uploads').insert({
        material_id: id, object_key: upload.objectKey, r2_upload_id: upload.r2UploadId,
        part_size_bytes: upload.partSize, state: 'in_progress', expires_at: upload.expiresAt,
      });
      if (error) throw error;
    },
    async loadMultipartUpload(id: string): Promise<R2MultipartUpload | null> {
      const { data, error } = await adminClient.from('materials_multipart_uploads')
        .select('object_key, r2_upload_id, part_size_bytes, expires_at')
        .eq('material_id', id).eq('state', 'in_progress').maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { objectKey: data.object_key, r2UploadId: data.r2_upload_id, partSize: Number(data.part_size_bytes), expiresAt: data.expires_at };
    },
    async finishMultipartUpload(id: string): Promise<void> {
      const { error } = await adminClient.from('materials_multipart_uploads')
        .update({ state: 'completed' }).eq('material_id', id).eq('state', 'in_progress');
      if (error) throw error;
    },
    async abandonMultipartUpload(id: string): Promise<void> {
      const { error } = await adminClient.from('materials_multipart_uploads')
        .update({ state: 'aborted' }).eq('material_id', id).eq('state', 'in_progress');
      if (error) throw error;
    },
  };

  try {
    if (internalReap) return json(await reapVideoUploads(store), 200);
    if ((body as Record<string, unknown>)?.action === 'reap') return json({ error: 'Forbidden' }, 403);
    const result = await handleUploadSession(body, user!, store);
    return json(result.body, result.status);
  } catch (error) {
    console.error('[video-upload-session] Request failed', error);
    return json({ error: 'Upload session failed; retry the request' }, 503);
  }
});
