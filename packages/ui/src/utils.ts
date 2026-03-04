export function joinClassNames(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}
