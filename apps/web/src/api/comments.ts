import { apiClient } from "./client";

export interface CommentMention {
  userId: string;
  displayName: string;
  offset: number;
  length: number;
}

export interface CommentAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface CommentCanvasDrawing {
  /** 序列化的矢量批注（线条 / 箭头）的相对坐标 [0,1]² 列表，由 ReviewWorkbench 写入。 */
  shapes: Array<{
    type: "line" | "arrow" | "rect" | "ellipse";
    points: number[];
    stroke?: string;
  }>;
}

export interface AnnotationCommentResponse {
  id: string;
  annotation_id: string;
  project_id: string | null;
  author_id: string;
  author_name: string | null;
  body: string;
  is_resolved: boolean;
  is_active: boolean;
  mentions: CommentMention[];
  attachments: CommentAttachment[];
  canvas_drawing: CommentCanvasDrawing | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateCommentPayload {
  body: string;
  mentions?: CommentMention[];
  attachments?: CommentAttachment[];
  canvas_drawing?: CommentCanvasDrawing | null;
}

export interface AttachmentUploadInit {
  storage_key: string;
  upload_url: string;
  expires_in: number;
}

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
