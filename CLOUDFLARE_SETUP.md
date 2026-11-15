# TeslaNavigation — Cloudflare Workers + D1

Deze branch bevat de Cloudflare-migratie. De bestaande `main`-branch en de gepubliceerde Lovable-app worden niet door deze wijzigingen aangepast.

## Eenmalige Cloudflare-inrichting

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

Maak een willekeurige geheime code van minimaal 32 tekens en stel die als Cloudflare Worker secret in:

```bash
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
```

Publiceer de Worker en open de nieuwe Worker-URL. Maak via `/auth` een account aan. Open daarna opnieuw `/auth`, kies **Eerste beheerder activeren** en voer de geheime code in. Alleen zolang er nog geen beheerder bestaat, accepteert de server deze code.

Verwijder de tijdelijke secret direct na succesvolle activatie:

```bash
npx wrangler secret delete ADMIN_BOOTSTRAP_TOKEN
```

## Build en deploy

```bash
npm install
npm run build
npx wrangler deploy
```

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

De oude live Supabase-database is niet automatisch gekopieerd. De GitHub-repository bevat de meegeleverde basisdataset en tariefbestanden; handmatige wijzigingen die alleen in de oude live database stonden, moeten nog als back-up worden geïmporteerd. De admin-importfunctie voegt gegevens toe of werkt ze bij en verwijdert geen bestaande locaties.

De oude Supabase Storage-bucket met geüploade meldingsfoto's is ook niet overgezet. Nieuwe rapporten kunnen absolute afbeeldingslinks bewaren; oude private bucketpaden worden niet meer ondertekend.

## URL

De bestaande `teslanavigation.lovable.app`-URL blijft eigendom van Lovable. Na deploy krijgt de Worker eerst een `workers.dev`-URL. Voor een eigen domein moet dat domein aan Cloudflare zijn gekoppeld en als Worker Custom Domain worden ingesteld.
