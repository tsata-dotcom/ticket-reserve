import DOMPurify from 'isomorphic-dompurify';

export function sanitizeRichText(html: string | null | undefined): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style'],
  });
}
