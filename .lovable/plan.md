
# Plan: Admin, Auth, Opgeslagen routes & Route-varianten

## 1. Authenticatie
- Email/wachtwoord + Google sign-in (Lovable Cloud managed).
- Auth-pagina op `/auth` (login + registreren).
- `profiles` tabel (id, email) + auto-create trigger op signup.
- `user_roles` tabel + enum `app_role` (`admin`, `user`) + `has_role()` security-definer functie.
- Bij signup van `purelark3842@outlook.com` → automatisch `admin` role toekennen via trigger (met email-verificatie check).
- Header rechtsboven: Login / Account-menu (Uitloggen, Mijn routes, Admin).

## 2. Superchargers uitbreiden
Nieuwe kolommen op `superchargers`:
- `max_speed_kw` (int)
- `versions` (text[]) — bv `{V2,V4}`
- `opening_time` (time, nullable = 24/7)
- `closing_time` (time, nullable = 24/7)
- `trailer_friendly` (bool, default false)

RLS/GRANT: iedereen mag lezen; alleen admins mogen insert/update/delete (`has_role(auth.uid(), 'admin')`).

## 3. Admin-modus
Route `/admin` — beschermd, alleen zichtbaar/toegankelijk voor admins.
- Tabel met alle superchargers (zoeken, sorteren).
- "Toevoegen" knop → dialoog met alle velden (coords, aantal, snelheid, versies-multiselect, openingstijden, aanhanger-checkbox).
- Bewerken (zelfde dialoog) en verwijderen (met bevestiging).
- Klik op kaart in admin-modus vult coords automatisch in.

## 4. Openingstijden-logica
Bij route-berekening: geschatte aankomsttijd per charger berekenen (nu + rijtijd + laadtijd van eerdere stops). Als charger dan dicht is → niet gebruiken als optie.
Tijdens navigatie: als geschatte aankomsttijd door vertraging buiten openingstijd valt → waarschuwing + auto-herberekening.

## 5. Aanhanger-vriendelijk filter
Als aanhangermodus aan staat en route-type = "Aanhangervriendelijk" → alleen chargers met `trailer_friendly = true` gebruiken.

## 6. Vier route-varianten
Tabs boven de route-uitkomst: **Snelste** | **Minste stops** | **Toeristisch** | **Aanhangervriendelijk** (alleen als aanhanger aan).
- Snelste: huidige logica, HERE `fastest`.
- Minste stops: `chargeTargetPercent = 100`, `maxArrivalAtChargerPercent = 5` → laad vol, kom leeg aan.
- Toeristisch: HERE `avoid=motorway` (geen snelwegen).
- Aanhangervriendelijk: snelste + filter op `trailer_friendly`.
Elk tabblad toont stops + tijd + afstand voor die variant.

## 7. Opgeslagen routes
`saved_routes` tabel per user:
- `name`, `start_address`, `start_coords`, `end_address`, `end_coords`
- `model_name`, `battery_percent`, `trailer_mode`, `weather_mode`, `time_mode`
- `route_type` (snelste/minste/toeristisch/aanhanger)
- `charger_ids` (uuid[]) — snapshot van laders in de route
- `total_distance_km`, `total_time_min`

RLS: user ziet/beheert alleen eigen routes.
UI: "Opslaan" knop na berekening → dialoog voor naam. `/mijn-routes` pagina → lijst, klik = laden + navigeren met dezelfde stops.

## 8. Bestandswijzigingen
- **Migraties**: kolommen, tabellen, RLS/GRANTs, triggers.
- **Nieuw**: `src/routes/auth.tsx`, `src/routes/_authenticated/admin.tsx`, `src/routes/_authenticated/mijn-routes.tsx`, `src/components/AdminChargerDialog.tsx`, `src/components/SaveRouteDialog.tsx`, `src/components/RouteTabs.tsx`, `src/components/AccountMenu.tsx`.
- **Bewerken**: `tesla-utils.ts` (varianten + openingstijden), `tesla.functions.ts` (nieuwe velden), `EvMap.tsx`, `NavigationPanel.tsx` (vertraging → herberekenen), `routes/index.tsx` (tabs + save-knop + account menu), `__root.tsx` (onAuthStateChange).

Klaar om te bouwen?
