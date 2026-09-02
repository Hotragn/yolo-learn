// Extend React's intrinsic elements to support WebMCP declarative attributes.
// These custom attributes are part of the WebMCP spec for declarative tool registration.

import "react"

declare module "react" {
  interface HTMLAttributes<T> {
    toolname?: string
    tooldescription?: string
    toolparamdescription?: string
  }
}
