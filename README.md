# Crate Digger

Crate Digger récupère les morceaux SoundCloud dont l'artiste a **activé le téléchargement gratuit officiel**, et rien d'autre : pas de rip de stream, pas de conversion. Tu lui donnes le profil d'un curateur ; il parcourt tous les comptes que ce curateur suit, repère leurs morceaux téléchargeables et les range dans un seul dossier, prêts pour tes mixs.

## Installation

Il te faut Google Chrome, Microsoft Edge ou Brave sur l'ordinateur : Crate Digger s'en sert pour te connecter à SoundCloud.

**macOS**

1. Dans la page *Releases* du projet, télécharge `crate-macos-arm64.tar.gz` (Mac à puce Apple : M1, M2, M3, M4) ou `crate-macos-x64.tar.gz` (Mac Intel), puis décompresse-le : tu obtiens un fichier nommé `crate`.
2. macOS bloque les programmes téléchargés hors App Store. Une seule fois : ouvre le Terminal (Applications › Utilitaires), tape `xattr -d com.apple.quarantine ` avec l'espace final, glisse le fichier `crate` dans la fenêtre pour insérer son chemin, puis Entrée.
3. Lance-le par un double-clic sur `crate`, ou en le glissant dans une fenêtre du Terminal puis Entrée.

**Windows**

1. Dans la page *Releases*, télécharge `crate-windows-x64.zip` et décompresse-le : tu obtiens `crate.exe`.
2. Au premier lancement, si SmartScreen affiche un avertissement, clique sur *Informations complémentaires* puis *Exécuter quand même*.
3. Double-clique sur `crate.exe`.

## Utilisation

1. Au premier lancement, Crate Digger ouvre une fenêtre de navigateur sur la page de connexion SoundCloud. Connecte-toi là, jamais dans le terminal. Cette fenêtre utilise un profil à part, vide au départ : tes favoris et extensions n'y sont pas, et ton navigateur habituel n'est pas touché. Elle se ferme d'elle-même une fois connecté, et la session est gardée pour les prochaines fois.
   - Google ou Apple refuse la connexion (« navigateur non sécurisé ») ? Appuie sur `M` : une fenêtre normale s'ouvre, connecte-toi, puis quitte ce navigateur (⌘Q maintenu sur Mac). Crate Digger reprend seul.
   - Tu veux tes extensions dans cette fenêtre, par exemple ton gestionnaire de mots de passe ? Active la synchronisation Chrome dedans, une seule fois.
2. Colle l'adresse d'un profil curateur, par exemple `https://soundcloud.com/nom-du-curateur`, puis Entrée.
3. Le scan tourne : comptes suivis, morceaux inspectés, morceaux éligibles. À la fin, un récapitulatif indique combien sont en **HIGH** (fichiers originaux sans perte : wav, aiff, flac) et en **LOW** (mp3, m4a…). Choisis : tout, HIGH seulement, LOW seulement, ou quitter.
4. Les fichiers arrivent à plat dans `Documents/Music/Crate Digger`, nommés `Artiste - Titre.ext`.

## Bon à savoir

- Seuls les morceaux publics, téléchargeables officiellement et de moins de 12 minutes sont pris. Pour changer la limite : `crate --max-minutes 20`.
- Un morceau déjà téléchargé ne l'est jamais deux fois, même via un autre curateur. Le fichier `index.json` du dossier en est la mémoire : ne le supprime pas.
- Ctrl+C arrête proprement. Relance plus tard : il reprend là où il en était.
- `crate logout` oublie la session SoundCloud.
- Chrome semble vide, sans favoris ? C'est la fenêtre Crate Digger encore ouverte après un plantage : quitte-la (⌘Q maintenu) et rouvre Chrome.

## Pour les développeurs

Node 22 : `npm install`, `npm start` (même flux que le binaire), `npm test`, `npm run typecheck`. Binaires avec [Bun](https://bun.sh) : `npm run build` produit `dist/windows-x64/crate.exe`, `dist/macos-arm64/crate` et `dist/macos-x64/crate` ; pousser un tag `v*` les publie dans *Releases* via GitHub Actions. `npm run mock` lance un faux SoundCloud hors ligne pour tester tout le flux. `CRATE_DEBUG=1` écrit un journal sans token dans `~/.config/crate/debug.log`.
