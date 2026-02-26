import type { MDXComponents } from "mdx/types";
import { Callout } from "./components/callout";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Callout,
    ...components,
  };
}
