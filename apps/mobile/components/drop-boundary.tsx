import { Component, type ReactNode } from "react";
import {
  reportRouteError,
  type RouteErrorBoundaryKind,
} from "@/components/route-error";

/**
 * Catches a render error in something the app can drop without the screen
 * under it (a quick-actions sheet, an overlay in the overlay layer), reports
 * it (`error_boundary: sheet` or `overlay`), and draws nothing; `onError`
 * lets the host drop it, so the next open mounts it fresh.
 */
export class DropBoundary extends Component<
  {
    boundary: Extract<RouteErrorBoundaryKind, "sheet" | "overlay">;
    onError: () => void;
    children: ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportRouteError(error, { boundary: this.props.boundary });
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
