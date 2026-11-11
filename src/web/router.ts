import { useEffect, useState } from 'react';

const read = () => location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');

/** Routeur minimal par ancre (#/saisons) : fonctionne sans configuration serveur. */
export function useRoute(): string {
  const [route, setRoute] = useState(read());
  useEffect(() => {
    const on = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const isActive = (route: string, path: string): boolean =>
  path === '' ? route === '' : route === path || route.startsWith(`${path}/`);
