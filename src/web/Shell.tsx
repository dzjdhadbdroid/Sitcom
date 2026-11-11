import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons.tsx';
import { MOBILE_TABS, NAV } from './nav.ts';
import { isActive } from './router.ts';
import type { Me } from './api.ts';
import { ROLE_LABEL } from './api.ts';

interface Props { me: Me; title: string; route: string; children: ReactNode }

/** Structure générale : menu latéral (ordinateur), tiroir (tablette), barre du bas + tiroir (smartphone). */
export function Shell({ me, title, route, children }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [route]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const link = (item: (typeof NAV)[number]) => (
    <a key={item.path} href={`#/${item.path}`} className="nav-link" aria-current={isActive(route, item.path) ? 'page' : undefined}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </a>
  );

  return (
    <div className="shell">
      <a href="#contenu" className="skip" onClick={(e) => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}>Aller au contenu</a>

      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Navigation principale" id="menu">
        <div className="sidebar-head">
          <strong className="brand" title={title}>{title}</strong>
          <button className="icon-btn drawer-close" onClick={() => setOpen(false)} aria-label="Fermer le menu"><Icon name="close" /></button>
        </div>
        <nav>{NAV.slice(0, -1).map(link)}</nav>
        <div className="sidebar-foot">
          {link(NAV[NAV.length - 1])}
          <div className="who">
            <span className="avatar" aria-hidden="true">{(me.name ?? me.email).charAt(0).toUpperCase()}</span>
            <span className="who-text"><span>{me.name ?? me.email}</span><small>{ROLE_LABEL[me.role]}</small></span>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn hamburger" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" aria-expanded={open} aria-controls="menu"><Icon name="menu" /></button>
          <strong className="topbar-title">{title}</strong>
        </header>
        <main id="contenu" tabIndex={-1}>{children}</main>
      </div>

      <nav className="tabbar" aria-label="Navigation rapide">
        {MOBILE_TABS.map((p) => {
          const item = NAV.find((n) => n.path === p)!;
          return (
            <a key={p} href={`#/${p}`} className="tab" aria-current={isActive(route, p) ? 'page' : undefined}>
              <Icon name={item.icon} />
              <span>{item.label === 'Tableau de bord' ? 'Accueil' : item.label}</span>
            </a>
          );
        })}
        <button className="tab" onClick={() => setOpen(true)} aria-expanded={open} aria-controls="menu">
          <Icon name="more" />
          <span>Plus</span>
        </button>
      </nav>
    </div>
  );
}
