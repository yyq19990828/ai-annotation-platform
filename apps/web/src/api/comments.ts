import { apiClient } from "./client";
import type {
  Mention,
  Attachment,
  CanvasDrawing,
  AnnotationCommentOut,
  AnnotationCommentCreate,
  CommentAttachmentUploadInitResponse,
} from "./generated/types.gen";

// ── 类型再导出（向后兼容旧 import 名） ─────────────────────────────
//
// v0.6.4 起后端把 mentions / attachments / canvas_drawing 字段从 dict 改成
// 结构化的 Mention / Attachment / CanvasDrawing Pydantic 模型，codegen 直接
// 出强类型。下面把生成的类型按旧名再导出。

export type CommentMention = Mention;
export type CommentAttachment = Attachment;
export type CommentCanvasDrawing = CanvasDrawing;
export type AnnotationCommentResponse = AnnotationCommentOut;
export type CreateCommentPayload = AnnotationCommentCreate;
export type AttachmentUploadInit = CommentAttachmentUploadInitResponse;

export const commentsApi = {
  listByAnnotation: (annotationId: string) =>
    apiClient.get<AnnotationCommentResponse[]>(`/annotations/${annotationId}/comments`),

  create: (annotationId: string, payload: CreateCommentPayload) =>
    apiClient.post<AnnotationCommentResponse>(`/annotations/${annotationId}/comments`, payload),

  patch: (id: string, payload: { body?: string; is_resolved?: boolean }) =>
    apiClient.patch<AnnotationCommentResponse>(`/comments/${id}`, payload),

  remove: (id: string) => apiClient.delete<void>(`/comments/${id}`),

  /** 评论附件上传初始化：返回预签名 PUT URL 与 storageKey；前端需直接 PUT 到 url 上传文件。 */
  attachmentUploadInit: (annotationId: string, payload: { file_name: string; content_type: string }) =>
    apiClient.post<AttachmentUploadInit>(
      `/annotations/${annotationId}/comment-attachments/upload-init`,
      payload,
    ),
};
