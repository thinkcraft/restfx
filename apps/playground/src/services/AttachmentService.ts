export interface AttachmentMetadata {
  readonly id: string;
  readonly bytes: number;
  readonly contentType: "application/octet-stream";
}

interface StoredAttachment extends AttachmentMetadata {
  readonly content: Buffer;
}

export class AttachmentService {
  private readonly attachments = new Map<string, StoredAttachment>();

  save(id: string, content: Buffer): AttachmentMetadata {
    const stored: StoredAttachment = {
      id,
      bytes: content.byteLength,
      contentType: "application/octet-stream",
      content: Buffer.from(content),
    };
    this.attachments.set(id, stored);
    return this.getMetadata(stored);
  }

  get(id: string) {
    const attachment = this.attachments.get(id);
    return attachment ? Buffer.from(attachment.content) : undefined;
  }

  private getMetadata(attachment: StoredAttachment): AttachmentMetadata {
    return {
      id: attachment.id,
      bytes: attachment.bytes,
      contentType: attachment.contentType,
    };
  }
}
