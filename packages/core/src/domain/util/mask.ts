const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** `jane.doe@example.com` -> `j***@example.com`; applied to every address in the text. */
export const maskEmails = (text: string): string => text.replace(EMAIL, '$1***@$2');

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
