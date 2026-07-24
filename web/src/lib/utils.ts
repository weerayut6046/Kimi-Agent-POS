import { clsx, type ClassValue } from "clsx"

let mergeClassNames = (className: string) => className

export function configureClassNameMerge(
  merge: (className: string) => string
) {
  mergeClassNames = merge
}

export function cn(...inputs: ClassValue[]) {
  return mergeClassNames(clsx(inputs))
}
