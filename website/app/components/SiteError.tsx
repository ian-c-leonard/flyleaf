import { Component, type ReactNode } from 'react';
import { TreeIcon } from '@phosphor-icons/react';

/** If part of the site fails to draw, say so plainly instead of leaving a
 * blank page. Reloading starts the site afresh. */
export default class SiteError extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="kin-opening">
        <TreeIcon size={32} />
        <h1>Something went wrong</h1>
        <p role="alert">This page could not be shown. Reload to try again.</p>
        <button className="kin-button" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
