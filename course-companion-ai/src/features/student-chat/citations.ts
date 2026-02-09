export const getCitationKey = (messageId: string, citationNumber: number) => `${messageId}-${citationNumber}`;

export const markdownWithCitationLinks = (content: string) =>
  content.replace(/\[(\d+)\]/g, '[$1](citation:$1)');
