import {
  HttpContext,
  HttpGet,
  HttpPut,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import { AttachmentPathRequest } from "../models/AttachmentPathRequest.js";
import { AttachmentService } from "../services/AttachmentService.js";

const maxAttachmentBytes = 5 * 1024 * 1024;

@HttpResource({
  path: "attachments",
  tag: "Attachments",
  description: "Binary attachment upload and download",
})
export class AttachmentsResource {
  @Inject(AttachmentService)
  private readonly attachments!: AttachmentService;

  @HttpPut({
    path: ":attachmentId",
    summary: "Upload an attachment",
    description:
      "Uploads one binary attachment. This in-memory playground example accepts up to 5 MiB per upload.",
    tags: ["Attachments"],
    request: AttachmentPathRequest,
    requestBody: {
      description: "Raw attachment bytes",
      required: true,
      contentType: "application/octet-stream",
      schema: { type: "string", format: "binary" },
    },
    responses: {
      "201": {
        description: "Attachment stored",
        schema: {
          type: "object",
          required: ["id", "bytes", "contentType"],
          properties: {
            id: { type: "string" },
            bytes: { type: "integer" },
            contentType: { type: "string", const: "application/octet-stream" },
          },
        },
      },
      "413": { description: "Attachment exceeds the upload size limit" },
    },
  })
  async upload(context: HttpContext) {
    const { attachmentId } = await context.req.model(AttachmentPathRequest);
    const bytes = await context.req.parseBody<Buffer>(maxAttachmentBytes);
    const metadata = this.attachments.save(attachmentId, bytes);
    return new HttpResult(201, metadata);
  }

  @HttpGet({
    path: ":attachmentId",
    summary: "Download an attachment",
    tags: ["Attachments"],
    request: AttachmentPathRequest,
    responses: {
      "200": {
        description: "Raw attachment bytes",
        contentType: "application/octet-stream",
        schema: { type: "string", format: "binary" },
      },
      "404": { description: "Attachment not found" },
    },
  })
  async download(context: HttpContext) {
    const { attachmentId: id } = await context.req.model(AttachmentPathRequest);
    const attachment = this.attachments.get(id);
    if (!attachment) return new HttpResult(404);
    return new HttpResult(200, attachment, {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${encodeURIComponent(id)}"`,
    });
  }
}
