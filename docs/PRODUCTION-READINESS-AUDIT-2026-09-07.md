**Audyt gotowości produkcyjnej — IQM Kiosk, 7 września 2026**

> Ten raport zachowuje stan **sprzed poprawek**. Zmiany i wyniki ponownej walidacji opisuje [raport napraw](./PRODUCTION-READINESS-FIXES-2026-09-07.md).

**Werdykt: wstrzymać wdrożenie bez nadzoru do usunięcia dwóch problemów P1.** Standardowe wyjścia z modułów sprzątają zasoby poprawnie w krótkim teście, ale przerwanie przejścia między ekranami ujawnia rzeczywisty wyciek sceny. Zawieszone ładowanie obrazu może natomiast zablokować cały kiosk, łącznie z powrotem po bezczynności.

Znaleziono **7 problemów: 2 × P1, 5 × P2, 0 × P0**. P1 oznacza poprawę przed wdrożeniem; P2 — istotną poprawkę lub lukę w walidacji, z ograniczonym zakresem skutków albo dostępnym obejściem. Nie wprowadzono zmian w kodzie aplikacji. Dodano raport, wyniki pomiarów i skrypty reprodukcji.

Badano bieżące drzewo robocze. HEAD przy zamknięciu audytu: `eb9975c9db37ec67a67e00ea17eade01cc970b2a` (`Polish visuals and interactions across modules`). Projekt docelowo działa offline na Windows 11 i pionowym ekranie 2160 × 3840. Pomiary wykonano lokalnie na macOS, Electron **39.8.10**, Chromium **142.0.7444.265**; build na Node **22.14.0**.

**Wyniki walidacji**

| Sprawdzenie | Wynik | Zakres wniosku |
| --- | --- | --- |
| `npm run build` na Node 22 | PASS | Składnia 145 plików, 20/20 testów, walidacja kamery Nanoscale, 70 wymaganych assetów przed i po buildzie |
| Vite production build | PASS z ostrzeżeniem rozmiaru chunków | Największe chunki JS ok. 666 i 674 kB; sam rozmiar nie dowodzi problemu w kiosku offline |
| Istniejący `leak:soak`, 3 cykle po rozgrzewce, dwell 6000 ms | 10/11 celów bez dodatnich delt DOM; wszystkie bez delt obiektów WebGL i dekoderów | 8 modułów i 3 podgry; test używa trybu przeglądarkowego, nie pełnego uruchomienia produkcyjnego |
| Szybkie wyjście podczas powrotu z podgry | FAIL | Dwie osierocone pętle RAF i ponad 1000 zachowanych węzłów DOM po dwóch powtórzeniach |
| Błąd utworzenia renderera podgry | FAIL | Nieobsłużone odrzucenie Promise i niedomknięte przejście |
| Zawieszony request obrazu Nanoscale | FAIL | Opaque wipe, ukryty stage i brak reakcji na próby powrotu |
| Jednorazowy błąd odczytu manifestu | FAIL | Drugie wywołanie nie próbuje ponownie wykonać fetch |
| Smoke lokalnego protokołu na `dist` | PASS | 3 wymagane assety dostępne, statusy i rozmiary poprawne; to nie jest test instalatora Windows ani pełnej ścieżki odtwarzania |
| Błąd otwarcia strumienia pliku | FAIL | Odpowiedź 200 z błędem body, bez automatycznego ponowienia |
| Podatności zależności / CVE | POMINIĘTO | Zgodnie z decyzją użytkownika nie wysyłano drzewa zależności do rejestru npm |

Pierwsze uruchomienie buildu zakończyło się błędem na domyślnym Node 18. Po użyciu wymaganej wersji Node build przeszedł. Nie jest to defekt aplikacji.

**1. [P1] Przerwanie przejścia QVC pozostawia poprzednią grę aktywną**

Lokalizacja: [quantum-vs-classical/index.js:520](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:520), analogicznie [index.js:570](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:570); cleanup [index.js:616](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:616). Kategoria: pamięć, GPU, cykl życia.

`showMenu()` i `openGame()` zapisują `outgoingGame` w zmiennej lokalnej, zerują `gameController`, a następnie czekają na animację. Jeśli w trakcie nastąpi wyjście z modułu, `dispose()` nie widzi już starej gry. Przerwana funkcja wraca przed `disposeAfterViewSwap(outgoingGame)`. Poprzednia scena pozostaje właścicielem aktywnego RAF, listenerów i zasobów WebGL.

**Reprodukcja:** wejść do Superposition, wybrać Back, a po 40 ms opuścić moduł przez normalną nawigację aplikacji. Przed pomiarami wymuszono GC. W teście diagnostycznym ustawiono `app.runtime.isKiosk = true` po starcie, aby uzyskać produkcyjne natychmiastowe odmontowanie, zachowując dostęp do uchwytu aplikacji.

| Stan po powrocie do głównego menu | Węzły DOM | Listenery CDP | Aktywne RAF Superposition | Żywe konteksty WebGL |
| --- | ---: | ---: | ---: | ---: |
| Poprawny Back, potem wyjście — baseline | 918 | 74 | 0 | 6 |
| Przerwane przejście nr 1 | 1446 | 84 | 1 | 6 |
| Przerwane przejście nr 2 | 1970 | 97 | 2 | 7 |

Liczba programów WebGL rosła `51 → 54 → 57`. Pozostawione callbacki pochodzą z `superposition-game.js:877`. To potwierdzony wyciek, a nie opóźnienie garbage collectora lub jednorazowe rozgrzanie cache.

**Skutek:** narastający koszt CPU/GPU i pamięci w kolejnych sesjach odwiedzających; z czasem większe ryzyko spadków płynności i utraty kontekstów.

**Poprawka:** zachować wszystkie odchodzące kontrolery w rejestrze należącym do modułu aż do ich zwolnienia. Sprzątać je w `dispose()` i na każdej ścieżce abort/error; użyć `try/finally` wokół przejścia. Test regresji powinien przerywać rzeczywisty Back oraz przejście do następnej gry i sprawdzać, że nie pozostają RAF ani dodatkowe zasoby GPU.

**2. [P1] Zawieszone ładowanie blokuje zasłonę, nawigację i idle recovery**

Lokalizacja: [app.js:387](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/app.js:387), [app.js:408](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/app.js:408), [nanoscale-assets.js:47](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/nanoscale/nanoscale-assets.js:47), [idle-navigation.js:15](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/core/idle-navigation.js:15). Kategoria: odporność na awarie.

Wipe bez limitu czasu czeka na mount/presentation-ready. Ładowanie i dekodowanie obrazów Nanoscale również nie ma deadline. Dopóki Promise pozostaje pending, `isOpeningExperience` pozostaje `true`; `openMenu()` i `goHome()` odmawiają nawigacji, a idle jedynie ponawia timer. Watchdog Electron reagujący na nieodpowiadający renderer nie naprawi takiej sytuacji: event loop nadal działa.

**Reprodukcja:** przed startem aplikacji zasymulowano request `nanoscale/splash-room.webp`, który nie emituje ani `load`, ani `error`. Po 6 sekundach od wejścia i ponownie po wywołaniu `onIdle()`, `openMenu()` oraz `goHome()` stan był identyczny: `opening: true`, `screen: module`, `wipe: is-active is-covering`, stage ukryty. Brak deadline w kodzie oznacza, że sam upływ kolejnych sekund nie rozwiąże oczekiwania. Nie stwierdzono, że zwykłe ładowanie tego pliku zawsze się zawiesza — test dotyczył kontrolowanej awarii.

**Poprawka:** dodać ograniczony czas montowania i przygotowania prezentacji, z rzeczywistym abort oraz zwolnieniem zasobów. Zamykać zasłonę i zerować blokadę w `finally`, również przy błędzie. Umożliwić wymuszone wyjście/retry po przekroczeniu limitu. Nanoscale powinno mieć osobny deadline ładowania/dekodowania i resetować przerwany cache prefetch. Sam `Promise.race` bez anulowania pracy pozostawi problem zasobów w tle.

**3. [P2] Błąd tworzenia podgry QVC nie przywraca działającego widoku**

Lokalizacja: [quantum-vs-classical/index.js:584](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:584), [index.js:604](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:604), [index.js:613](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/quantum-vs-classical/index.js:613). Kategoria: obsługa błędów.

`game.create()` może rzucić wyjątek, np. przy nieudanej alokacji kontekstu. Wywołania `void openGame()` i `void showMenu()` nie mają `catch`, a przejście nie ma `finally`. Moduł pozostaje oznaczony jako aktywny, ale gra zostaje pod stanem `is-transitioning` i `aria-busy=true`; Back jest wtedy ignorowany. Główny ModuleHost nie przechwytuje tego błędu, ponieważ jego początkowy mount już się zakończył.

**Reprodukcja:** wstrzyknięto wyjątek konstruktora renderera przez kontekst assetów przekazywany do faktycznej fabryki gry. Po 3 sekundach nadal `transitioning: true`, `busy: true`, `hostState: active`; zarejestrowano `unhandledrejection`. Wyjście z całego modułu pozostaje obejściem, stąd P2.

**Poprawka:** wspólna obsługa błędu przejść, zamknięcie zasłony, sprzątnięcie częściowo utworzonej sceny i przywrócenie menu lub czytelnego retry. Każda fabryka powinna sprzątać własne alokacje, jeśli nie zdąży zwrócić kontrolera.

**4. [P2] Nanowire renderuje pełną scenę projektową z DPR, niezależnie od jej skali ekranowej**

Lokalizacja: [nanowire-scene.js:408](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/build-nanowire/nanowire-scene.js:408), [nanowire-scene.js:1255](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/build-nanowire/nanowire-scene.js:1255). Kategoria: wydajność, pamięć GPU.

`renderer.setSize(host.clientWidth, host.clientHeight)` używa wymiarów przed transformacją kiosku, a `setPixelRatio()` mnoży je jeszcze przez DPR. Scena nie korzysta ze wspólnego budżetu pikseli, który inne moduły już mają.

**Pomiar:** przy viewport 540 × 960 i DPR 1 canvas wyświetlał się jako **540 × 930**, ale miał bufor **2160 × 3720**: **8,04 mln zamiast 0,50 mln pikseli, czyli 16× więcej**. To stosunek liczby pikseli, nie pomiar 16-krotnego przyspieszenia po poprawce. Przy natywnym 4K i DPR 1 pełny bufor odpowiada ekranowi. Przy Windows scaling 150% ten kod wylicza 3024 × 5208, około 15,75 mln pikseli — niemal 2× fizycznej powierzchni sceny na ekranie 4K; jest to wyliczenie z kodu, nie pomiar na Windows.

**Poprawka:** zastosować `calculateStageAwarePixelRatio()` i `elementCssScale()`, ustalić budżet powierzchni renderowania, ponownie obliczać DPR przy zmianie skali monitora. Zweryfikować główny widok i lupę na docelowym sprzęcie. Gry Superposition/Entanglement używają `getBoundingClientRect()` i nie mają tego samego błędu skali.

**5. [P2] Jednorazowy błąd manifestu wideo zostaje w cache do restartu**

Lokalizacja: [alpha-video.js:105](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/core/alpha-video.js:105). Kategoria: ponawianie odczytów, media.

`manifestPromise` zapamiętuje również odrzucony Promise. Kolejne wejścia do Protecting Information dostają ten sam błąd, mimo że plik może być już dostępny. Istnieje fallback do sceny 3D, więc moduł nie musi przestać działać, ale docelowa warstwa wideo nie wróci w tej sesji.

**Reprodukcja:** pierwszemu fetch wstrzyknięto błąd przejściowy; drugie wywołanie loadera ponownie zwróciło ten sam błąd, a licznik fetch pozostał **1**. Ręczne `resetAlphaVideoManifest()` natychmiast umożliwiło prawidłowy odczyt.

**Poprawka:** zerować `manifestPromise` po odrzuceniu, podobnie jak istniejące loadery coin assets i Nanoscale. Dodać deadline fetch oraz ograniczone ponawianie dla przejściowych błędów.

**6. [P2] Retry protokołu obejmuje stat, ale pomija rzeczywiste otwarcie pliku**

Lokalizacja: [app-protocol.cjs:183](/Users/robertciurus/SoftwareDev/iqm-kiosk/electron/app-protocol.cjs:183), [app-protocol.cjs:208](/Users/robertciurus/SoftwareDev/iqm-kiosk/electron/app-protocol.cjs:208), [app-protocol.cjs:249](/Users/robertciurus/SoftwareDev/iqm-kiosk/electron/app-protocol.cjs:249). Kategoria: niezawodność odczytu assetów.

`statWithRetry()` ponawia sprawdzenie metadanych. `createReadStream()` otwiera plik później, asynchronicznie; jego błąd nie jest złapany przez synchroniczny `try/catch` tworzący Response. Przejściowa blokada przy otwarciu, po udanym stat, nie korzysta z opisanej w kodzie ochrony przed blokadami skanera Windows.

**Reprodukcja:** na prawdziwym pliku testowym, po udanym stat, pierwszy `createReadStream` zwrócił strumień emitujący `EBUSY`. Handler zwrócił **200**, odczyt body odrzucił Promise, a liczba prób otwarcia wyniosła **1**. Ponowne ręczne żądanie odczytało ten sam plik poprawnie. Test nie uruchamiał antywirusa ani rzeczywistej blokady systemowej Windows.

**Poprawka:** otwierać plik przed zwróceniem Response, z ograniczonym retry dla transient errors, i przekazywać gotowy uchwyt do strumienia. Obsłużyć zamknięcie uchwytu na końcu, błędzie i anulowaniu; zachować Range i streaming bez buforowania całego filmu.

**7. [P2] Obecny soak może uznać niewykonany cykl za poprawny i nie sprawdza ścieżki produkcyjnej**

Lokalizacja: [leak-soak.cjs:302](/Users/robertciurus/SoftwareDev/iqm-kiosk/scripts/leak-soak.cjs:302), [leak-soak.cjs:363](/Users/robertciurus/SoftwareDev/iqm-kiosk/scripts/leak-soak.cjs:363), [runtime-policy.js:6](/Users/robertciurus/SoftwareDev/iqm-kiosk/src/js/modules/states-of-matter/runtime-policy.js:6). Kategoria: wiarygodność walidacji produkcyjnej.

Driver wywołuje `openModule`, czeka stałą liczbę milisekund i wywołuje `openMenu`, bez potwierdzenia zakończenia mountu ani odmontowania. Podczas wiszącego wipe oba kolejne żądania mogą być ignorowane, co daje stabilne liczniki i pozornie udane cykle. Podgry są badane przez bezpośrednie fabryki, więc test omija przejścia QVC odpowiedzialne za potwierdzony wyciek nr 1. Nie przechwytuje też błędów renderera jako automatycznych niepowodzeń celu.

BrowserWindow testu nie korzysta z produkcyjnego preload/runtime, więc `isKiosk` jest nieobecne. W efekcie uruchamia m.in. eksperymentalną parę WebGPU, wyłączoną w kiosku. To wyjaśnia obserwowane w States of Matter **+3 węzły i +3 listenery po 3 cyklach**; nie przypisuję tego wyniku ścieżce kioskowej. Instrumentacja GPU tego testu obejmuje WebGL, nie WebGPU. RSS zmieniające się po rozgrzewce również nie wystarcza do stwierdzenia wycieku.

**Poprawka:** jawny tryb produkcyjny i osobny tryb review; sprawdzanie właściwego id modułu, gotowości i faktycznego powrotu po każdym kroku, z timeoutem kończącym test błędem. Włączyć realistyczne przejścia, szybkie wyjścia, restart, fault injection oraz pomiar aktywnych RAF. Test powinien zawieść, jeśli nie wykonał zaplanowanej interakcji.

**Co działa dobrze i warto zachować**

ModuleHost ma tokeny aktualnego żądania, abort i obsługę nieaktualnego wyniku mountu. Wspólna pula WebGL ogranicza tworzenie kontekstów, a wiele scen jawnie zwalnia geometrie, materiały, render targets, obserwatory i listenery. `releaseVideoElement()` zatrzymuje odtwarzanie, usuwa źródło i resetuje pipeline. Krótki soak nie wykazał przyrostu pozostawionych dekoderów. Istnieją wspólne helpery budżetu renderowania, cache assetów z resetem błędu oraz odrębna polityka ryzykownej ścieżki WebGPU.

Electron ma `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, blokadę nowych okien i nawigacji oraz odmowę żądań uprawnień. Protokół chroni przed wyjściem poza katalog bundla i obsługuje byte ranges. Main process posiada recovery po crashu i nieodpowiadaniu renderera. To dobre podstawy; test nr 2 pokazuje klasę zawieszenia logicznego poza zakresem tego watchdoga.

**Pomocniczy przegląd jakości frontendu**

Oceny wynikają z przeglądu kodu i opisanych prób. Nie są certyfikacją WCAG ani oceną wydajności docelowego GPU. Responsywność oceniono względem stałego pionowego kiosku, bez wymagania niezamówionej wersji mobilnej czy dark mode.

| Wymiar | Ocena / 4 | Uzasadnienie |
| --- | ---: | --- |
| Dostępność | 2 | Są semantyczne przyciski, etykiety, stany ARIA i obsługa reduced motion; gry z monetami opierają podstawowe akcje na pointerach. Nie wykonano pełnego pomiaru kontrastu ani audytu czytnika ekranu |
| Wydajność | 2 | Cleanup zwykłych ścieżek i pooling działają; potwierdzono osierocone renderowanie oraz nadmiarowy bufor Nanowire |
| Skalowanie na ekran kiosku | 3 | Wspólny StageScaler i stała powierzchnia projektowa; pozostaje weryfikacja zmiany monitorów i DPI na Windows |
| Tokeny i schematy | 3 | Wspólne tokeny i trzy schematy bandu; lokalne palety scen wymagają oceny w kontekście artworku, nie automatycznej zamiany na jeden kolor |
| Spójność implementacji UI | 3 | Wspólne explainery, tooltipy, band/outro i udokumentowane wyjątki; nie ma podstaw do zarzutu systemowego rozjazdu wizualnego |
| **Łącznie** | **13/20** | **Ocena pomocnicza; o wdrożeniu decydują problemy P1** |

Detektor Impeccable zgłosił 9 sygnałów. Domniemany brak obrazka w `nanoscale-assets.js:210` jest fałszywym alarmem na komentarzu z tekstem `<img>`. Trzy sygnały typografii dotyczą playgroundów/debug view. Gradientowe napisy, siatka i overshoot wymagają oceny zgodności z zastanym projektem, a nie automatycznego uznania za błąd produkcyjny. `transition: height` i `will-change: height` w `states-of-matter/styles.css:210` rzeczywiście istnieją, ale dotyczą zmiany panelu; bez śladu kosztownego layoutu nie podnoszę ich do osobnego priorytetowego problemu.

**Kolejność działań i warunki zakończenia**

1. Naprawić właścicielstwo odchodzących scen oraz deadline/abort zasłony — oba P1. Weryfikować rzeczywiste porzucone przejścia i wiszące ładowanie, nie tylko poprawne wejście/wyjście. Zakres `$impeccable harden`.
2. Domknąć obsługę błędu podgry, reset cache manifestu i retry otwarcia plików. Zakres `$impeccable harden` oraz poprawka protokołu Electron.
3. Ujednolicić budżet Nanowire i zmierzyć go w trakcie budowania, skanowania oraz działania lupy. Zakres `$impeccable optimize`.
4. Uzupełnić soak zgodnie z pkt 7, a następnie wykonać test długotrwały na zainstalowanym buildzie Windows: rzeczywisty GPU, 4K, ustawienia DPI klienta, kompletne przejścia i szybkie dotknięcia. Rejestrować czasy klatek p50/p95/p99, JS heap po GC, RAM procesów, zasoby GPU i dekodery. Ustalić docelowy budżet klatki przed oceną PASS.
5. Zapewnić lokalne logi awarii z rotacją. Obecny main głównie używa `console`; logi instalatora nie zastępują historii błędów renderera w czasie wielogodzinnej pracy. To luka operacyjna do uzupełnienia, nie dodatkowy odtworzony crash.
6. Powtórzyć audyt po naprawach (`$impeccable audit`); na końcu krótki `$impeccable polish` bez poszerzania zakresu wizualnego. Poprawki można wykonać osobno albo razem.

Nie wykonano wielogodzinnego soak, pomiarów na docelowym Windows/GPU, instalacji NSIS, testu rzeczywistego resetu sterownika, pełnego audytu dostępności ani audytu podatności zależności. Nie ma podstaw do deklaracji stabilnych 60 FPS na urządzeniu klienta ani braku wszystkich wycieków. Priorytetowe problemy wskazane wyżej mają konkretne reprodukcje lub jednoznaczny pomiar.

**Dowody i odtworzenie**

Wyniki: [build.log](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/build.log), [leak-soak.json](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/leak-soak.json), [runtime-faults.json](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/runtime-faults.json), [stalled-load.json](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/stalled-load.json), [protocol-open-fault.json](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/protocol-open-fault.json), [protocol-smoke.log](/Users/robertciurus/SoftwareDev/iqm-kiosk/docs/audits/2026-09-07/protocol-smoke.log).

Skrypty diagnostyczne uruchamiają lokalne okno Electron, Vite na portach 5244/5245 i kontrolowane błędy wyłącznie w procesie testowym. Startować pojedynczo z katalogu repozytorium na wymaganym Node. Nie uruchamiać na obsługującym odwiedzających kiosku.

```sh
npm run build
npm run leak:soak -- --cycles 3 --dwell 6000 --out /tmp/iqm-audit-soak.log
./node_modules/.bin/electron docs/audits/2026-09-07/reproduce-runtime.cjs
./node_modules/.bin/electron docs/audits/2026-09-07/reproduce-stalled-load.cjs
./node_modules/.bin/electron scripts/smoke-packaged-protocol.cjs
```

Skrypty dodatkowe zapisują nowe pomiary w `/tmp/iqm-audit-runtime.json` i `/tmp/iqm-audit-stall.json`. Zachowane kopie w katalogu audytu dokumentują ten konkretny przebieg. Instrukcje używają ścieżek i powłoki środowiska audytu; test Windows wymaga osobnego uruchomienia na urządzeniu docelowym.
