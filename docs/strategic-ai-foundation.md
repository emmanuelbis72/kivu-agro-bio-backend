# Assistant strategique IA - fondation

## Architecture a deux niveaux

1. `kivu_deterministic_analytics` calcule les chiffres a partir de PostgreSQL.
2. Le modele conversationnel explique les resultats certifies et formule des recommandations.
3. Les chiffres du modele conversationnel sont ignores au profit du resultat deterministe.

Le contrat analytique contient :

- `metrics`
- `tables`
- `charts`
- `forecast`
- `methodology`
- `sources`
- `data_quality`
- `recommendation_details`

## Routes

- `POST /api/auth/bootstrap` : creation du premier administrateur.
- `POST /api/auth/login` : authentification JWT.
- `GET /api/auth/me` : utilisateur actif.
- `GET|POST /api/analytics/run` : analyse deterministe complete.
- `POST /api/ai/ask` : analyse certifiee puis explication conversationnelle.
- `GET /api/audit` : journal d'audit filtre.

Le journal est append-only : PostgreSQL refuse toute modification ou suppression
d'une ligne d'audit existante.

## Mise en service de l'authentification

1. Definir `AUTH_BOOTSTRAP_TOKEN` avec une valeur aleatoire longue.
2. Appeler `/api/auth/bootstrap` lorsque la table `users` est vide.
3. Se connecter via `/api/auth/login`.
4. Passer `Authorization: Bearer <token>`.
5. Regler `AUTH_ENFORCEMENT_MODE=strict`.

Le mode `transition` conserve la compatibilite des lectures et analyses pendant
la creation des comptes. Les modifications IA sensibles exigent deja un compte.

## Archivage

Les suppressions des produits, clients et depenses deviennent des archivages.
Une facture supprimee est annulee, son stock est restaure, ses lignes sont
conservees et l'operation est auditee. Les listes courantes masquent les archives.

## Limites de la premiere version

- La marge nette est encore estimee globalement.
- Les couts logistiques, commissions et pertes ne sont pas affectes a chaque vente.
- Le score de paiement est explicable mais non calibre statistiquement.
- Les previsions utilisent une moyenne mobile ponderee, adaptee a l'historique actuel.
