// Browsers supply their own Origin. Metro selects requestOrigin.native.ts for
// iOS/Android, whose fetch implementation does not supply a browser origin.
export const requestOrigin: (url: string) => string | undefined = () => undefined;
