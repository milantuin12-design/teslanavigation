# Persoonlijke functies – implementatieplan TeslaNavigation

Branch: `cloudflare-migratie`

## Veiligheidsregels
- Bestaande `users`, rollen, sessies, Superchargerrecords en bestaande routes blijven behouden.
- Nieuwe accountgegevens worden per `user_id` opgeslagen; een gebruiker kan nooit gegevens van een andere gebruiker lezen of wijzigen.
- D1-wijzigingen zijn uitsluitend additieve migraties. Geen bestaande tabellen of Superchargerdata worden vervangen.
- Lokale favorieten worden bij de eerste accountlogin naar D1 overgezet; bestaande favorieten worden niet verwijderd.
- Meldingen blijven standaard uit totdat de gebruiker ze expliciet inschakelt en de benodigde verzendconfiguratie is ingesteld.

## Bestaande onderdelen die hergebruikt moeten worden
- Routekeuze bevat al snelste, goedkoopste en minste laadstops.
- Locaties vergelijken bestaat al.
- Favorieten bestaan al in de browseropslag; account-synchronisatie wordt toegevoegd.
- De kaart gebruikt al satellietbeelden als basislaag.
- Routeplanner heeft al zomer-/wintermodus, aanhangerinstellingen, minimum laadvermogen en laadpercentages.
- Bestaande voertuigcatalogus en opgeslagen routes moeten behouden blijven.

## Nieuwe basis in deze wijzigingsreeks
- [x] Additieve D1-migratie voor meerdere persoonlijke voertuigen.
- [x] Additieve D1-migratie voor accountgebonden Supercharger-favorieten en persoonlijke notities.
- [x] Additieve D1-migratie voor push-abonnementen (opslag; verzending nog niet geactiveerd).
- [x] Afgeschermde D1-serverfuncties voor voertuigen, favorieten en notities.
- [x] Uitbreiding van gevalideerde accountvoorkeuren voor uiterlijk, kaart, route en meldingen.
- [x] Synchronisatie van favorieten met het ingelogde account, met behoud van lokale favorieten.
- [ ] Accountinstellingenscherm uitbreiden en alle voorkeuren aan de interface koppelen.
- [ ] Meerdere voertuigen beheren vanuit het accountscherm en koppelen aan de routeplanner.
- [ ] Persoonlijke notities vanuit de Supercharger-detailweergave beheren.
- [ ] Satelliet-/kaartlaagkeuze, zoom, kaartpuntstijl en eigen statuskleuren instelbaar maken.
- [ ] Routevoorkeuren opslaan en daadwerkelijk toepassen op de berekening.
- [ ] E-mailmeldingen integreren met een verzendprovider en veilige secrets.
- [ ] Pushmeldingen integreren met service worker, VAPID-configuratie, toestemming en intrekken.
- [ ] Profielfoto en eigen Tesla-afbeelding veilig opslaan via Cloudflare R2 of een gevalideerde externe afbeelding.
- [ ] Taal, eenheden, thema, lettergrootte en weergavedichtheid overal in de interface toepassen.
- [ ] Tests toevoegen voor eigenaarschap, invoervalidatie, accountisolatie en migratiebehoud.

## Acceptatie vóór publicatie
1. CI-tests en productiebuild moeten groen zijn op de nieuwste commit.
2. D1-migratie wordt eerst gecontroleerd en daarna toegepast; geen handmatige database-reset.
3. Test met bestaand account: inloggen, adminrol, routes, favorieten en Superchargerdata blijven intact.
4. Test met tweede account: geen toegang tot voertuigen, favorieten of notities van het eerste account.
5. Pas na geslaagde tests wordt de Cloudflare Worker gepubliceerd.
