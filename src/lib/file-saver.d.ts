declare const saveAs: {
  (data: Blob | string, filename?: string, options?: { autoBom?: boolean }): void;
  saveAs: (data: Blob | string, filename?: string, options?: { autoBom?: boolean }) => void;
};
export default saveAs;
