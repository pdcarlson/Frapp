export declare const SEARCH_INDEXING_ENABLED: boolean;
export declare const SEARCH_ROBOTS_METADATA:
  { readonly index: false; readonly follow: false } | undefined;
export declare function searchIndexingHeaders(): Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}>;
