import type { VisitorRule } from './game-rules';

/** The banner a special visitor's payment shows: who liked the café, the quote and the popularity. */
export function visitorReview(visitor: VisitorRule): { title: string; detail: string } {
  const points = visitor.popularityTenths / 10;
  return {
    title: `${visitor.name} ${visitor.critic ? 'elogiou o café!' : 'adorou o café!'}`,
    detail: `“${visitor.review}”${points > 0 ? ` · +${String(points).replace('.', ',')} de popularidade` : ''}`,
  };
}
