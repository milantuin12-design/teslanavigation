# TeslaNavigation — Cloudflare Workers + D1

Deze branch bevat de Cloudflare-migratie. De bestaande `main`-branch en de gepubliceerde Lovable-app worden niet door deze wijzigingen aangepast.

## Eenmalige Cloudflare-inrichting

De D1-database is al aangemaakt in jouw Cloudflare-account. Het database-ID staat al in `wrangler.toml`. De tabellen van migraties 0001 en 0002 zijn ook al handmatig aangemaakt; de deployworkflow gebruikt `IF NOT EXISTS`, zodat deze bestaande tabellen behouden blijven.


De D1-database kan niet vanuit GitHub worden aangemaakt: daarvoor is toegang tot het Cloudflare-account nodig. Maak hem eenmalig aan:

```bash
npx wrangler login
npx wrangler d1 create teslanavigation
```

Cloudflare geeft een `database_id` terug. Zet die waarde in `wrangler.toml` bij de binding:

```toml
[[d1_databases]]
binding = "DB"
database_name = "teslanavigation"
database_id = "PLAK-HIER-DE-ECHTE-DATABASE-ID"
migrations_dir = "migrations"
```

Voer daarna het schema uit:

```bash
npx wrangler d1 migrations apply teslanavigation --remote
```

## Eerste beheerder veilig activeren

1. Publiceer eerst de Worker via de GitHub Actions-deployworkflow hieronder.
2. Open in Cloudflare **Workers & Pages → teslanavigation → Settings → Variables and Secrets**.
3. Voeg `ADMIN_BOOTSTRAP_TOKEN` toe als **Secret**. Gebruik een willekeurige code van minimaal 32 tekens en bewaar deze tijdelijk.
4. Open de nieuwe `workers.dev`-URL met `/auth`, maak een account aan met jouw e-mailadres en een nieuw wachtwoord van minimaal 10 tekens.
5. Kies **Eerste beheerder activeren** en voer de geheime code in. Dit werkt alleen zolang er nog geen beheerder bestaat.
6. Verwijder daarna `ADMIN_BOOTSTRAP_TOKEN` uit de Worker-secrets. De beheerder blijft bestaan.

De bestaande Supabase-accounts en wachtwoordhashes zijn nog niet overgezet. Je moet daarom op de nieuwe app opnieuw registreren; je oude wachtwoord wordt niet herkend zolang de accountdata niet is geïmporteerd.

## Deploy via GitHub Actions (zonder Lovable-credits)

1. Open [GitHub Actions Secrets](https://github.com/milantuin12-design/teslanavigation/settings/secrets/actions).
2. Voeg deze twee **Repository secrets** toe:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API-token met rechten om Workers Scripts te bewerken en D1-databases te beheren.
   - `CLOUDFLARE_ACCOUNT_ID`: jouw Cloudflare Account ID.
3. Open [GitHub Actions](https://github.com/milantuin12-design/teslanavigation/actions).
4. Kies **Deploy TeslaNavigation to Cloudflare** → **Run workflow** → branch `cloudflare-migratie`.
5. Wacht tot installatie, tests, productiebuild, D1-migraties en Worker-deploy allemaal groen zijn.

De workflow zet de bootstrapcode niet als GitHub-secret. Die voeg je pas na de deploy rechtstreeks als Worker-secret toe via de stappen hierboven.


De Wrangler-configuratie verwacht de Nitro Cloudflare Worker-output in `.output/server/index.mjs` en statische bestanden in `.output/public`.

## Wat de migratie al omzet

- Inloggen, registreren, uitloggen en sessies: Cloudflare D1.
- Beheerdersrechten en adminbewaking aan de serverkant: D1.
- Superchargerbeheer, eigenaren, bulkbewerkingen, rapporten, voertuigen, talen, vertalingen, wijzigingshistorie en gebruikersbeheer: D1.
- Opgeslagen routes, gedeelde routes en meldingen/gesprekken: D1.
- Eerste vulling van de D1-Superchargerlijst uit de meegeleverde Europese JSON-dataset.
- Veilige versie-update van de ingebouwde basisdata: nieuwe locaties worden toegevoegd en basisgegevens van automatisch beheerde locaties worden ververst; handmatige status-, openingstijden-, notitie-, foto-, parkeer- en prijsblokwijzigingen blijven behouden.
- De actuele kWh-tarieven uit het bestand dat op 11 november 2026 is gecontroleerd worden als tijdsblokken toegevoegd waar nog geen handmatige tijdsblokken bestaan. Vaste tarieven worden als één blok van 00:00–24:00 opgeslagen.
- Als D1 nog niet beschikbaar is, blijft de publieke kaart terugvallen op de meegeleverde dataset.

## Belangrijk over bestaande live gegevens

De oude live Supabase-database is niet automatisch gekopieerd. De D1-database wordt bij de eerste start gevuld met de meegeleverde openbare Europese basisdataset en tariefbestanden, maar bevat nog niet de bestaande gebruikers, opgeslagen routes, meldingen, privéfoto's of handmatige wijzigingen die alleen in de oude live database stonden. Die gegevens moeten eerst uit Supabase worden geëxporteerd en daarna gecontroleerd worden geïmporteerd. De admin-importfunctie voegt gegevens toe of werkt ze bij en verwijdert geen bestaande locaties.

De oude Supabase Storage-bucket met geüploade meldingsfoto's is ook niet overgezet. Nieuwe rapporten kunnen absolute afbeeldingslinks bewaren; oude private bucketpaden worden niet meer ondertekend.

## URL

De bestaande `teslanavigation.lovable.app`-URL blijft eigendom van Lovable. Na deploy krijgt de Worker eerst een `workers.dev`-URL. Voor een eigen domein moet dat domein aan Cloudflare zijn gekoppeld en als Worker Custom Domain worden ingesteld.
