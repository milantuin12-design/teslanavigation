# Complete persoonlijke functies – TeslaNavigation

Branch: `cloudflare-migratie`

## Doel
Alle functies uit de twee gebruikerslijsten toevoegen aan TeslaNavigation. De bestaande Superchargerkaart blijft uitsluitend Tesla Superchargers tonen (Europa en Turkije). Bestaande accounts, rollen, sessies, routes en Superchargerrecords worden niet vervangen of gewist.

## Veiligheidsregels
- Alleen additieve D1-migraties; geen reset, drop of overschrijving van bestaande gebruikers- of Superchargerdata.
- Alle persoonlijke gegevens worden per ingelogde `user_id` afgeschermd.
- Invoer wordt server-side gevalideerd; geen account-ID uit de browser vertrouwen.
- Foto's worden niet als grote base64-strings in D1 opgeslagen. Gebruik later R2 met bestandstype- en groottecontrole.
- E-mail en push staan standaard uit totdat provider-/VAPID-configuratie en daadwerkelijke aflevering getest zijn.
- Persoonlijke verberg-/filterinstellingen verbergen nooit een Supercharger uit de centrale database.
- Geen enkele routeberekening mag een gesloten of ongeschikte Supercharger als bruikbare stop voorstellen.

## Bestaande functies die worden hergebruikt
- Routeprioriteiten snelste, goedkoopste en minste laadstops.
- Locaties vergelijken.
- Favorieten (nu ook account-sync in voorbereiding).
- Satellietbeelden als bestaande kaartbasis.
- Zomer-/winterverbruik, aanhanger, minimum laadvermogen en aankomstpercentage in de routeplanner.
- Bestaande route-opslag en voertuigcatalogus.

## Reeds aan de Cloudflare/D1-kant voorbereid
- [x] D1-tabellen voor meerdere voertuigen, accountfavorieten, persoonlijke notities en push-abonnementen.
- [x] Serverfuncties voor voertuigen, favorieten en persoonlijke notities.
- [x] Gevalideerde accountvoorkeuren voor profiel, taal, thema, kaart, route en meldingen.
- [x] Favorieten synchroniseren met account met behoud van lokale favorieten.
- [x] Extra additieve opslag voor persoonlijke labels, recent bekeken en verborgen locaties, routeprofielen, laadsessies, meldingsinbox en vastgezette laadstops.
- [x] Accountgebonden serverfuncties voor deze extra gegevens.

## Nog te koppelen aan de gebruikersinterface en te testen

### Profiel en account
- [ ] Profielfoto uploaden via veilige objectopslag.
- [ ] Profielkleur kiezen.
- [ ] Eigen begroeting instellen.
- [ ] Eigen Tesla-afbeelding.
- [ ] Taal instellen.
- [ ] Eenheden aanpassen.
- [ ] Compacte/uitgebreide weergave.
- [ ] Lettergrootte aanpassen.
- [ ] Donkere/lichtmodus.
- [ ] Instellingen exporteren en importeren.
- [ ] Eigen dashboard samenstellen.

### Voertuigen en energie
- [ ] Meerdere voertuigen beheren en automatisch het juiste voertuig voor een route selecteren.
- [ ] Zomer- en winterverbruik per voertuig.
- [ ] Maximale laadsnelheid en aankomstpercentage per voertuig.
- [ ] Aanhangerinstellingen per voertuig.
- [ ] Accudegradatie registreren en meenemen in bereik.
- [ ] Laadcurve per Tesla-uitvoering.
- [ ] Accutemperatuur als schatting tonen.
- [ ] Extra verbruik door winterbanden, dakdrager of dakkoffer.
- [ ] Verbruik per snelheid instellen/leren.
- [ ] Werkelijk verbruik vergelijken met de route-inschatting.
- [ ] Laadgeschiedenis en persoonlijke laadstatistieken.

### Kaart en Superchargerlocaties
- [ ] Satelliet-/wegenkaart wisselen en standaard zoomniveau instellen.
- [ ] Eigen statuskleuren instellen.
- [ ] Kaartpunten en labels aanpassen.
- [ ] Landen onthouden.
- [ ] Eigen kaartfilters opslaan.
- [ ] Favorieten apart tonen.
- [ ] Persoonlijke notities en labels bij locaties.
- [ ] Locaties recent bekeken tonen.
- [ ] Locaties persoonlijk verbergen zonder ze centraal te verwijderen.
- [ ] Waarschuwingsradius rond favorieten.
- [ ] Filteren op aantal laadplaatsen/stalls.
- [ ] Kaart automatisch centreren op de route.
- [ ] Locaties sorteren op afstand.
- [ ] Nieuwe of gewijzigde locaties melden.
- [ ] Gesloten locaties melden.
- [ ] Prijswijzigingen melden.
- [ ] Favoriet-heropeningswaarschuwing.
- [ ] Prijswijzigingsoverzicht per week.

### Routeplanning
- [ ] Goedkoopste, snelste en minste-stops route als blijvende profielkeuze toepassen.
- [ ] Alternatieve routes naast elkaar vergelijken.
- [ ] Vertrek- en aankomsttijd voorspellen.
- [ ] Verkeersinformatie meenemen in laadadvies (alleen als betrouwbare verkeersbron beschikbaar is).
- [ ] Hoogteverschillen meenemen in verbruiksraming.
- [ ] Een laadstop vastzetten.
- [ ] Een laadstop overslaan en herberekenen.
- [ ] Aankomstpercentage per tussenstop instellen.
- [ ] Eigen routeprofielen opslaan.
- [ ] Maximale omrijafstand instellen.
- [ ] Maximale afstand tussen laadstops instellen.
- [ ] Standaard laadpauze instellen.
- [ ] Minimum laadvermogen instellen.
- [ ] Waarschuwing voor prijsgrens instellen.

### Meldingen
- [ ] In-app meldingen volledig koppelen aan gebeurtenisdetectie.
- [ ] E-mailmeldingen via een geconfigureerde verzendprovider.
- [ ] Pushmeldingen via service worker en VAPID; toestemming en uitschrijven ondersteunen.
- [ ] Statuswaarschuwingen voor favorieten.
- [ ] Meldingen voor nieuwe locaties, sluitingen en prijswijzigingen.
- [ ] Meldingen voor heropening van favorieten.
- [ ] Wekelijks prijsoverzicht.

## Test- en publicatievolgorde
1. Eerst de migraties en serverfuncties testen op een testdatabase.
2. Daarna de accountinstellingen en voertuig-/kaart-/route-UI aansluiten.
3. Daarna gebeurtenisdetectie en meldingsbezorging testen met meldingen standaard uit.
4. CI moet `npm test` en `npm run build` succesvol afronden op de nieuwste commit.
5. Test bestaand account, adminrechten, bestaande opgeslagen routes, favorieten en Superchargerdata.
6. Test met een tweede account dat geen persoonlijke gegevens van het eerste account kan lezen of wijzigen.
7. Pas na alle controles de D1-migraties en Worker publiceren.

**Status:** de opslaglaag is uitgebreid, maar dit betekent nog niet dat alle functies al zichtbaar of actief zijn in de gepubliceerde app. Geen productiepublicatie totdat alle controles groen zijn.
