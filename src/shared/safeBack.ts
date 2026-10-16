/**
 * App-aware back navigation.
 * router.back() on a direct-loaded web page has no app history behind it, so
 * the browser can dump the user out to its home page. Fall back to the home
 * feed when there is nothing to go back to.
 */
export function safeBack(router: { back: () => void; push: (href: string) => void }) {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back();
  } else {
    router.push('/');
  }
}
