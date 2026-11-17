# TeslaNavigation – persoonlijke functies

## Veilig implementatieplan

Uitgangspunt: uitsluitend de Cloudflare-migratiebranch uitbreiden. De bestaande `users`, `user_roles`, `sessions`, `superchargers` en `saved_routes` blijven behouden. Geen bestaande rijen verwijderen of herschrijven.

### Al aanwezig (controleren en hergebruiken)
- Routevarianten met goedkoopste, snelste en minste laadstops.
- Favorieten (momenteel lokaal in de browser).
- Superchargerlocaties vergelijken.
- Bestaande voertuigkeuze, batterijpercentage, aankomstpercentage en aanhangermodus.
- Accountinstellingen met profielnaam, aanspreekvorm, één voertuigprofiel en basis-meldingsvoorkeuren.
- Meertalige interface via de bestaande LanguageProvider.

### Fase 1 – accountgegevens en voorkeuren
- Uitbreiden van accountvoorkeuren met profielkleur, eigen begroeting, taal, eenheden, thema, lettergrootte, compacte/uitgebreide weergave, kaarttype, zoom, kaartfilters, landen en statuskleuren.
- Voertuigprofielen uitbreiden naar meerdere voertuigen met zomer-/winterverbruik, maximale laadsnelheid, Tesla-afbeelding, aankomstpercentage en aanhangerinstellingen.
- Instellingen per account opslaan; bestaande velden en accounts blijven intact.

### Fase 2 – Superchargerpersoonlijk
- Favorieten server-side aan het account koppelen, met lokale favorieten als terugval tijdens migratie.
- Persoonlijke notities per gebruiker en Supercharger opslaan.
- Bestaande vergelijkingsdialoog hergebruiken en uitbreiden met favorieten/notities.
- Minimumvermogen en eigen kaartfilters toepassen op de bestaande filterlogica.

### Fase 3 – routevoorkeuren
- Bestaande goedkoopste/snelste/minste-stops berekeningen hergebruiken.
- Instelbare standaard laadpauze, omrijafstand en maximale afstand tussen laadstops toevoegen.
- Eerst controleren dat alle instellingen daadwerkelijk door de routeberekening worden gebruikt; alleen opslaan is niet voldoende.

### Fase 4 – meldingen en uploads
- Profielfoto's en eigen Tesla-afbeeldingen pas activeren na configuratie van private objectopslag (bij voorkeur Cloudflare R2), met bestandstype-, grootte- en toegangscontrole.
- E-mail pas activeren na een mailprovider en geverifieerde afzender.
- Push pas activeren na HTTPS-service-worker, VAPID-sleutels, abonnementsbeheer en toestemming van de gebruiker.
- Status-, prijs-, nieuwe-locatie- en sluitingsmeldingen via één server-side gebeurtenisverwerking aanbieden, met voorkeuren per account.

### Fase 5 – controle en uitrol
- Tests voor accountisolatie (gebruiker A kan nooit voorkeuren, favorieten of notities van gebruiker B lezen).
- Migraties eerst op niet-productie controleren; geen destructive SQL.
- `npm test`, `npm run build` en GitHub Actions moeten groen zijn.
- Pas daarna handmatig deployen naar Cloudflare. De productie-uitrol wordt niet automatisch gestart door deze branch.

## Acceptatiecriteria
- Bestaande login, wachtwoordhashes, adminrollen en Superchargerrecords blijven ongewijzigd.
- Elke persoonlijke instelling is accountgebonden en wordt na opnieuw inloggen teruggeladen.
- Geen melding of upload wordt als actief getoond zolang de externe infrastructuur niet is geconfigureerd.
- Bestaande planner-, kaart-, admin- en prijsfuncties blijven werken.
