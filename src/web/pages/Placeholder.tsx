import { SECTION_INFO } from '../nav.ts';

/** Rubrique dont les fonctionnalités arrivent dans une phase ultérieure : état vide honnête, sans bouton inactif. */
export function Placeholder({ section }: { section: string }) {
  const info = SECTION_INFO[section];
  if (!info) return <NotFound />;
  return (
    <>
      <h1>{info.title}</h1>
      <div className="card empty-state">
        <p>{info.text}</p>
        <p className="muted">Cette rubrique n'est pas encore disponible : elle sera développée lors de la phase {info.phase} du projet.</p>
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <h1>Page introuvable</h1>
      <div className="card"><p>Cette page n'existe pas. <a href="#/">Retour au tableau de bord</a></p></div>
    </>
  );
}
