"use client";

import { Component, type ReactNode } from "react";
import { SegmentError } from "@/components/shared/segment-error";

/**
 * The chat panel's own error boundary (#3779). Chat used to be the `/chat`
 * route, under `app/(dashboard)/error.tsx`; it is a shell panel now, above
 * every route's boundary, so without this a chat render error would take the
 * whole dashboard to `app/error.tsx`. It draws the same card the segment
 * boundary does, reports the same way (`SegmentError`), and Retry remounts
 * the panel.
 */
export class ChatPanelBoundary extends Component<
  {
    children: ReactNode;
    /**
     * Clears a caught error when it changes. The shell passes the pathname, so
     * moving to another route retries chat, as leaving the `/chat` segment
     * reset its boundary when chat was a page.
     */
    resetKey?: string;
  },
  { error: Error | null; errorKey: string | undefined }
> {
  state: { error: Error | null; errorKey: string | undefined } = {
    error: null,
    errorKey: undefined,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    this.setState({ errorKey: this.props.resetKey });
  }

  componentDidUpdate() {
    if (this.state.error && this.props.resetKey !== this.state.errorKey) {
      this.setState({ error: null, errorKey: undefined });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full max-w-md p-4">
          <SegmentError
            error={this.state.error}
            retry={() => this.setState({ error: null, errorKey: undefined })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
