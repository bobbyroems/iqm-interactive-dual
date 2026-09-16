# Poprawki po audycie — 7 września 2026

Zakres: siedem ustaleń z [audytu](./PRODUCTION-READINESS-AUDIT-2026-09-07.md). Kod aplikacji, protokół Electron i testy zmieniono lokalnie, bez aktualizacji zależności.

| Ustalenie | Zmiana | Weryfikacja |
| --- | --- | --- |
| P1: osierocona podgra QVC | Rejestr właścicieli obejmuje także odchodzące kontrolery. Wyjście zwalnia je podczas przejścia; spóźniony wynik fabryki jest od razu sprzątany. | Rzeczywisty Back i wyjście po 40 ms; brak osieroconych RAF i wzrostu obiektów WebGL. |
| P1: zawieszone ładowanie blokuje kiosk | Limit 15 s na obraz, 30 s na mount i gotowość prezentacji, abort i cleanup oraz istniejący ekran błędu z ponowieniem. Globalna blokada wejścia jest zwalniana w `finally`. Zabezpieczono też oczekiwanie na preview i przekazanie sceny Majorana. | Wstrzyknięty brak zdarzeń load/error kończy się ekranem błędu; zasłona znika, Home/Menu/idle odzyskują działanie. Testy obejmują spóźniony kontroler, zawieszone presentationReady i odmontowanie w trakcie oczekiwania. |
| P2: błąd fabryki podgry | Błąd trafia do wspólnego ModuleHost. Fabryki sprzątają częściowo utworzone zasoby; ponowienie buduje nowy moduł. | Wstrzyknięty błąd konstruktora renderera, brak nieobsłużonego odrzucenia, skuteczne ponowienie. |
| P2: rozdzielczość Nanowire | Główny renderer i lupa uwzględniają skalę CSS, DPR i budżet pikseli; reagują na resize. | Przy 540 × 960/DPR 1 główny bufor ma 540 × 930 zamiast 2160 × 3720. Usunięto 16-krotny nadmiar pikseli w tym przypadku; nie jest to pomiar przyspieszenia FPS. |
| P2: zatruty cache manifestu | Błąd zeruje cache, fetch ma limit 15 s; kolejne wywołanie ponawia odczyt. | Pierwszy fetch odrzuca, drugi zwraca manifest: dwie próby, sukces bez ręcznego resetu. |
| P2: błąd otwarcia pliku | Otwarcie następuje przed odpowiedzią, z ograniczonym retry błędów przejściowych. Strumień zwalnia uchwyt także przy anulowaniu. | EBUSY → poprawne 206 i byte range; trwały EIO → 503; HEAD bez otwierania; anulowanie zamyka deskryptor. Osobny smoke potwierdza odczyt Range z ASAR w Electron. |
| P2: niewiarygodny soak | Domyślny tryb kiosk korzysta z preload/runtime. Driver klika nawigację, potwierdza właściwy moduł, zakończony mount i odmontowanie. Wykrywa błędy, zatrzymane przejścia i pozostawione RAF. Dodano porzucony Back i zapis próbek po cyklach. | Test kończy się błędem przy niespełnieniu warunków; ujemna delta GPU oznacza zwolnienie zasobów, a nie wyciek. |

P1 w praktyce:

- **Wyciek:** ekran znikał, ale gra mogła nadal renderować się poza widokiem. Przerwanie animacji usuwało jedyną referencję używaną przez cleanup, zanim cleanup zdążył ją wykorzystać. Kolejne takie wyjścia kumulowały pamięć i pracę CPU/GPU. Kontroler jest teraz własnością modułu aż do faktycznego zwolnienia.
- **Blokada:** aplikacja czekała bez końca na obraz i przez cały czas traktowała wejście jako niezakończone. Przyciski i automatyczny powrót nie mogły rozpocząć kolejnej nawigacji. To logiczne zawieszenie przy nadal działającym procesie przeglądarki, więc sam watchdog crash/unresponsive go nie rozwiązywał. Limity oczekiwania kończą nieudaną próbę, sprzątają ją i umożliwiają ponowienie.

Odtworzenie na wymaganym Node 22.12+ z katalogu repozytorium:

Build końcowy: **149 plików sprawdzonych składniowo, 28/28 testów, walidacja kamery Nanoscale i 70 wymaganych assetów przed i po buildzie**. Pozostało standardowe ostrzeżenie Vite o chunkach przekraczających 500 kB.

Pełny przebieg 8 modułów, 3 podgier i porzuconego Back (3 cykle po rozgrzewce, dwell 2000 ms, Electron z runtime kiosk) nie wykazał przyrostu obiektów WebGL, aktywnych RAF, listenerów ani pozostawionych dekoderów. Pierwszy odczyt DOM zgłaszał miejscami +2 węzły. Dodatkowe cztery cykle ze snapshotami wykazały stałe 686 węzłów podłączonego DOM i wymianę dwóch pseudoelementów `::after` przycisków Home/Menu; licznik osiągał plateau. Skrypt teraz wymusza przeliczenie stylów przed końcowym GC. Dodatnie przyrosty nadal powodują błąd testu — nie podniesiono progu tolerancji.

Dowody: [build](./audits/2026-09-07/fixed-build.txt), [pełny przebieg przed stabilizacją pomiaru](./audits/2026-09-07/fixed-soak-initial.json), [diagnostyka DOM](./audits/2026-09-07/fixed-soak-dom-diagnostic.json), [recovery](./audits/2026-09-07/fixed-runtime-recovery.json), [zawieszony obraz](./audits/2026-09-07/fixed-stalled-load.json), [ASAR](./audits/2026-09-07/fixed-asar.txt), [protokół na końcowym dist](./audits/2026-09-07/fixed-protocol.txt). Detektor UI zgłosił wyłącznie znany fałszywy alarm na tekście `<img>` w komentarzu; zmian wyglądu nie wprowadzano.

```sh
npm run build
npm run check:recovery
npm run leak:soak -- --cycles 3 --dwell 2000
npm run smoke:protocol
```

Końcowa kontrola QVC po przeliczeniu stylów i kolejnych kolekcjach stert JS/Blink: **PASS**, trzy cykle zwykłego wejścia/wyjścia i trzy cykle porzuconego Back; delty DOM odpowiednio 0 i −2, GPU/listenery/dekodery/RAF bez przyrostu. [Próbki końcowe](./audits/2026-09-07/fixed-soak-qvc-final.json). Nie powtarzano całego zestawu ośmiu modułów po tej ostatniej zmianie sposobu pomiaru. Osobny `check:recovery` także **PASS**: DOM 918 → 918 → 918, zero RAF porzuconej podgry, działające ponowienie i powrót po timeout.

Skrypty recovery uruchamiają osobne lokalne okna Electron i serwery Vite na portach 5244/5245. Raporty zapisują w katalogu tymczasowym systemu. Nie uruchamiać ich na kiosku obsługującym odwiedzających.

Walidacja lokalna nie zastępuje wielogodzinnego przebiegu na docelowym Windows, GPU, 4K i DPI klienta. Pozostaje też operacyjne zalecenie lokalnych logów z rotacją z pierwotnego raportu. Nie wykonano audytu CVE ani wysyłania drzewa zależności do npm, zgodnie z decyzją użytkownika.
