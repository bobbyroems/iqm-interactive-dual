# QVC: przygotowanie efektów przed pierwszym użyciem

Superposition przygotowuje przed odsłonięciem sceny także ukrytą drugą monetę,
fizyczny materiał sfery, pierścienie i strzałkę. Interference przygotowuje ukryte
efekty i warianty przezroczystości części bojek używane podczas finału.

`warmSceneVariants` najpierw wywołuje `compileAsync`, następnie rzeczywisty render
na zasłoniętym canvasie, aby przesłać także bufory i tekstury. Zachowuje docelowy
wariant przestrzeni barw. Przygotowanie przywraca widoczność, culling i parametry
materiałów również przy błędzie; nie uruchamia animacji rozgrywki. Sygnał wyjścia
przerywa dalsze kroki po zakończeniu odczytów kompilatora, a istniejący rollback
fabryki zwalnia częściowo utworzoną scenę.

Koszt pierwszego użycia przeniesiono do zasłoniętego wejścia w podgrę, które może
potrwać nieco dłużej. Parametry docelowych efektów i przebieg rozgrywki pozostają
takie same.

Walidacja: build i 31 testów PASS. `npm run check:qvc-warmup` wykonuje dwa rzuty
monety i pełną sekwencję Interference w Electron. Licznik utworzonych programów
WebGL pozostaje 77 → 77 → 77 (gotowość, zwykły rzut, slow motion) oraz 95 → 95
(gotowość Interference, finał). To licznik całego procesu testowego, nie liczba
programów samej podgry. Brak nieobsłużonych odrzuceń.

[Wynik testu](./audits/2026-09-07/qvc-warmup.json). Test potwierdza brak nowych
programów w tych fazach, nie brak wszystkich możliwych przyczyn opóźnionej klatki.
Weryfikacja pierwszego uruchomienia na docelowym GPU pozostaje po stronie sprzętu.
