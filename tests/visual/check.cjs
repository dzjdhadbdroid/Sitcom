// Contrôle visuel et interactif de l'interface (test uniquement).
// Utilise un serveur SIMULÉ avec des données de test fictives : rien de tout cela n'est dans l'application déployée.
// Lancement : NODE_PATH=<dossier node_modules contenant esbuild, playwright, react> node tests/visual/check.cjs <dossier-de-sortie> [chemin-chrome]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const out = process.argv[2];
const chrome = process.argv[3] || undefined;
const root = path.join(__dirname, '..', '..');
fs.mkdirSync(out, { recursive: true });

async function build() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/web/main.tsx')], bundle: true, outdir: out, jsx: 'automatic', format: 'esm',
    loader: { '.css': 'css' }, entryNames: 'app', logLevel: 'error', nodePaths: (process.env.NODE_PATH || '').split(path.delimiter),
  });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
}

const state = {
  role: 'admin',
  series: { title: 'Série de test', genre: 'Comédie', format: 'Sitcom', summary: 'Résumé fictif utilisé uniquement pour le contrôle visuel.', plannedSeasons: 3, avgDurationMin: 22, audience: null, inspirations: null, notes: null, accentColor: null, updatedAt: null },
};
const me = () => ({ userId: 'u1', email: 'test@example.test', name: 'Utilisateur Test', picture: null, role: state.role, isOwner: state.role === 'admin' });

function server() {
  return http.createServer((req, res) => {
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/me') return json(200, me());
    if (url.pathname === '/api/series') {
      if (req.method === 'PUT') { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const p = JSON.parse(b); if (state.role === 'reader') return json(403, { erreur: 'forbidden' }); if (!p.title) return json(400, { erreur: 'invalid_title' }); Object.assign(state.series, p); json(200, { ok: true }); }); return; }
      return json(200, state.series);
    }
    if (url.pathname === '/api/dashboard') return json(200, { members: { total: 3, admins: 1, editors: 1, readers: 1 }, recentActivity: state.role === 'admin' ? [{ id: 'a', action: 'series.updated', actorName: 'Utilisateur Test', createdAt: new Date().toISOString() }] : null, recentDocuments: [{ id: 'doc1', title: 'Document fictif', category: 'script', modifiedTime: '2026-02-01T10:00:00.000Z', status: 'ok' }] });
    if (url.pathname === '/api/admin/members') return json(200, [{ id: 'u1', email: 'test@example.test', name: 'Utilisateur Test', role: 'admin', isOwner: 1, joinedAt: '2026-01-01' }]);
    if (url.pathname === '/api/admin/invitations') return req.method === 'POST' ? json(200, { id: 'i', expiresAt: '2026-12-01', lien: 'https://exemple.test/api/auth/login?invite=JETON' }) : json(200, []);
    if (url.pathname === '/api/documents') return json(200, [
      { id: 'doc1', driveFileId: 'x1', title: 'Document fictif', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-02-01T10:00:00.000Z', webViewLink: null, state: 'imported', category: 'script', sectionId: 'section:documents', status: 'ok', statusDetail: null, viewable: true },
      { id: 'doc2', driveFileId: 'x2', title: 'Document déplacé', mimeType: 'application/vnd.google-apps.document', modifiedTime: null, webViewLink: null, state: 'imported', category: 'notes', sectionId: 'section:documents', status: 'removed', statusDetail: 'x', viewable: true }]);
    if (url.pathname === '/api/documents/doc1/content') return json(200, { title: 'Document fictif', openUrl: 'https://docs.google.com/document/d/x1/edit', html: HOSTILE });
    if (url.pathname === '/api/documents/doc2/content') return json(409, { erreur: 'reauth_required', message: 'Reconnexion nécessaire.' });
    if (url.pathname === '/api/drive/status') return json(200, { connection: { status: 'active', lastSyncAt: null, lastError: null, connectedAt: '2026-01-01' }, folders: [{ id: 'f', folderId: 'F1', name: 'Dossier fictif', addedAt: '2026-01-01' }], canConnect: true });
    if (url.pathname === '/api/drive/folders') return json(200, [{ id: 'F9', name: 'Sous-dossier fictif' }]);
    if (url.pathname === '/api/drive/available') return json(200, [{ id: 'a1', driveFileId: 'y1', title: 'À importer', mimeType: 'application/vnd.google-apps.document', modifiedTime: null, webViewLink: null, state: 'available', category: null, sectionId: null, status: 'ok', statusDetail: null, viewable: true }]);
    if (url.pathname === '/api/auth/logout') return json(200, { ok: true });
    const file = path.join(out, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404); res.end();
  });
}

const HOSTILE = '<h1 onclick="window.__pwn=1">Titre</h1><p style="position:fixed">Bonjour <b>gras</b></p><script>window.__pwn=2</script><img src="https://evil.example/t.gif" onerror="window.__pwn=3"><img src="https://lh3.googleusercontent.com/ok.png"><a href="javascript:window.__pwn=4">piège</a><a href="https://exemple.test/x">lien</a><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input name="x"></form><svg onload="window.__pwn=5"></svg><table><tr><td colspan="2">cellule</td></tr></table>';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  await build();
  const srv = server();
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

  const sizes = { bureau: { width: 1280, height: 800 }, tablette: { width: 820, height: 1100 }, mobile: { width: 390, height: 844 } };
  for (const scheme of ['light', 'dark']) {
    for (const [sizeName, viewport] of Object.entries(sizes)) {
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      for (const route of ['', 'parametres/serie', 'saisons']) {
        await page.goto(`${base}/#/${route}`);
        await page.waitForSelector('main#contenu h1');
        const tag = `${sizeName}-${scheme}-${route.replace('/', '_') || 'accueil'}`;
        await page.screenshot({ path: path.join(out, `${tag}.png`), fullPage: false });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(`${tag} : pas de défilement horizontal`, overflow <= 0, `débordement ${overflow}px`);
      }
      check(`${sizeName}-${scheme} : aucune erreur console`, errors.length === 0, errors.join(' | '));

      if (sizeName !== 'bureau') {
        await page.goto(`${base}/#/`);
        await page.waitForSelector('main#contenu h1');
        const trigger = sizeName === 'mobile' ? page.getByRole('button', { name: 'Plus' }) : page.getByLabel('Ouvrir le menu');
        await trigger.click();
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(out, `${sizeName}-${scheme}-menu.png`) });
        const links = await page.locator('#menu .nav-link').count();
        check(`${sizeName}-${scheme} : tiroir contient les 9 rubriques`, links === 9, `${links} liens`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(350);
        const closed = await page.evaluate(() => !document.getElementById('menu').classList.contains('open'));
        check(`${sizeName}-${scheme} : Échap ferme le tiroir`, closed);
      }
      await ctx.close();
    }
  }

  // Parcours fonctionnels (bureau, thème clair)
  const ctx = await browser.newContext({ viewport: sizes.bureau, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(`${base}/#/`);
  await page.waitForSelector('main#contenu h1');
  const labels = await page.locator('#menu .nav-link').allInnerTexts();
  check('menu : ordre des 9 rubriques', JSON.stringify(labels.map((s) => s.trim())) === JSON.stringify(['Tableau de bord', 'Saisons', 'Personnages', 'Univers', 'Chronologie', 'Idées', 'Documents généraux', 'Archives', 'Paramètres']), labels.join(', '));
  for (const [name, hash] of [['Saisons', 'saisons'], ['Personnages', 'personnages'], ['Univers', 'univers'], ['Chronologie', 'chronologie'], ['Idées', 'idees'], ['Documents généraux', 'documents'], ['Archives', 'archives'], ['Paramètres', 'parametres']]) {
    await page.locator('#menu .nav-link', { hasText: name }).click();
    const active = await page.locator('#menu .nav-link[aria-current="page"]', { hasText: name }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    check(`navigation vers « ${name} »`, location_ok(await page.evaluate(() => location.hash), hash) && active, `${await page.evaluate(() => location.hash)}`);
  }
  await page.goto(`${base}/#/inexistant`);
  check('route inconnue : page introuvable', (await page.locator('h1').innerText()) === 'Page introuvable');

  // Fiche de la série : enregistrement
  await page.goto(`${base}/#/parametres/serie`);
  await page.getByLabel('Titre de la série').fill('Nouveau titre');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForSelector('[role="status"]');
  await page.goto(`${base}/#/`);
  check('fiche : le titre modifié apparaît sur le tableau de bord', (await page.locator('.hero h1').innerText()) === 'Nouveau titre');
  await page.goto(`${base}/#/parametres/serie`);
  await page.getByLabel('Titre de la série').fill('');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  // champ requis : le navigateur bloque l'envoi
  check('fiche : titre vide bloqué', (await page.locator('[role="status"]').count()) === 0);

  // Couleur principale
  await page.getByLabel('Titre de la série').fill('Nouveau titre');
  await page.getByLabel('Couleur principale de la série').fill('#b45309');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForSelector('[role="status"]');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  check('couleur principale appliquée à l’interface', accent === '#b45309', accent);

  // Thème manuel
  await page.goto(`${base}/#/parametres/affichage`);
  await page.getByRole('radio', { name: 'Sombre' }).click();
  check('thème sombre forcé', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.reload();
  await page.waitForSelector('main#contenu h1');
  check('thème conservé après rechargement', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.getByRole('radio', { name: 'Clair' }).click().catch(() => {});

  // Invitations
  await page.goto(`${base}/#/parametres/collaborateurs`);
  await page.getByLabel('Adresse e-mail').fill('invite@example.test');
  await page.getByRole('button', { name: "Créer l'invitation" }).click();
  await page.waitForSelector('.link');
  check('invitation : lien affiché', (await page.locator('.link').innerText()).includes('invite='));

  // Rôle lecteur : pas de gestion des collaborateurs, pas d'activité
  state.role = 'reader';
  await page.goto(`${base}/#/parametres/collaborateurs`);
  await page.reload();
  await page.waitForSelector('main#contenu h1');
  check('lecteur : collaborateurs réservés aux administrateurs', (await page.locator('main').innerText()).includes('réservée aux administrateurs'));
  await page.goto(`${base}/#/`);
  check('lecteur : pas de carte « Activité récente »', (await page.locator('#d-activity').count()) === 0);
  await page.goto(`${base}/#/parametres/serie`);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForSelector('.alert');
  check('lecteur : modification de la fiche refusée avec message', (await page.locator('.alert').innerText()).includes("pas le droit"));

  // Drive : onglet de réglages, liste et lecteur (HTML hostile fictif)
  state.role = 'admin';
  await page.goto(`${base}/#/parametres/drive`);
  await page.waitForSelector('main#contenu h1');
  await page.getByText('Synchroniser maintenant').waitFor();
  await page.getByText('À importer', { exact: true }).waitFor();
  const txt = await page.locator('main').innerText();
  check('drive : mention de la lecture seule', txt.includes('lecture seule'));
  check('drive : dossier synchronisé et document à importer listés', txt.includes('Dossier fictif') && txt.includes('À importer'));
  await page.screenshot({ path: path.join(out, 'drive-reglages.png'), fullPage: true });
  await page.goto(`${base}/#/documents`);
  await page.waitForSelector('.doclist');
  const list = await page.locator('main').innerText();
  check('documents : avertissement affiché pour un document inaccessible', list.includes('Supprimé ou accès retiré'));
  check('documents : aucun bouton de téléchargement', (await page.locator('main a[download], main button:has-text("Télécharger")').count()) === 0);
  await page.goto(`${base}/#/documents/doc1`);
  await page.waitForSelector('.reader');
  const reader = await page.evaluate(() => {
    const r = document.querySelector('.reader');
    return { html: r.innerHTML, pwn: window.__pwn, hrefs: [...r.querySelectorAll('a')].map((a) => a.getAttribute('href')), imgs: [...r.querySelectorAll('img')].map((i) => i.getAttribute('src')), style: !!r.querySelector('[style]'), onattr: [...r.querySelectorAll('*')].some((e) => [...e.attributes].some((a) => a.name.startsWith('on'))) };
  });
  check('lecteur : aucun script exécuté', reader.pwn === undefined, String(reader.pwn));
  check('lecteur : script, iframe, formulaire, svg supprimés', !/<(script|iframe|form|input|svg)/i.test(reader.html));
  check('lecteur : gestionnaires d’événements et styles supprimés', !reader.onattr && !reader.style);
  check('lecteur : liens javascript: supprimés, https conservés', reader.hrefs.every((h) => h === null || h.startsWith('https://')) && reader.hrefs.includes('https://exemple.test/x'), JSON.stringify(reader.hrefs));
  check('lecteur : seules les images Google sont conservées', reader.imgs.length === 1 && reader.imgs[0].includes('googleusercontent.com'), JSON.stringify(reader.imgs));
  check('lecteur : texte et mise en forme conservés', reader.html.includes('<b>gras</b>') && reader.html.includes('colspan="2"'));
  await page.screenshot({ path: path.join(out, 'lecteur.png') });
  await page.goto(`${base}/#/documents/doc2`);
  await page.waitForSelector('.alert');
  check('lecteur : message d’erreur lisible en français', (await page.locator('.alert').innerText()).includes('Reconnexion'));
  await page.goto(`${base}/#/`);
  await page.waitForSelector('#d-docs');
  check('tableau de bord : derniers documents réels affichés', (await page.locator('section[aria-labelledby="d-docs"]').innerText()).includes('Document fictif'));

  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

function location_ok(hash, expected) { return hash === `#/${expected}`; }
