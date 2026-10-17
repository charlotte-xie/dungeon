import { describeModelError } from '../engine/model/errors'

// The raw model error, one click away from a notice that shows the
// provider's readable message. Hidden when there is nothing more to show.
export function ErrorDetails({ error }: { error: string }) {
  if (describeModelError(error) === error) return null
  return (
    <details className="notice-details">
      <summary>Details</summary>
      <pre>{error}</pre>
    </details>
  )
}
