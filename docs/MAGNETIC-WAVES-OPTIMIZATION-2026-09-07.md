# Moduł 04: optymalizacja fal bez obniżania jakości

Zachowano 9 fal, 512 segmentów, rozdzielczość renderowania, wszystkie 17 próbek
rozmycia, ich pozycje i wagi, promień rozmycia, animację, szum oraz kolory.

Zmiany:

- Maska wpływu rozmycia jest wyliczana przed kosztownymi odczytami tekstury.
  Fragmenty o dokładnie zerowym wpływie nie wykonują dalszych obliczeń.
  Jeśli wpływ zeruje kanał alfa centralnej próbki, pomijane jest pozostałe
  16 odczytów. Nie dodano przybliżonego progu odcinającego delikatne krawędzie.
- Drugi przebieg renderowania korzysta ze sceny zawierającej tylko pole
  rozmycia. Nie przelicza ponownie całego modelu, cząstek i świateł.
  Geometria i materiał są współdzielone, a transformacja świata kopiowana
  z oryginalnej fali. Ukrycie rodzica wyłącza także ten przebieg.
- Pozostawiono pełną kopię framebufferu i tę samą kolejność kompozycji.
  Zwalnianie zasobów nadal należy do oryginalnej sceny.

Walidacja lokalna w Electron:

- Porównanie przed/po na rzeczywistej geometrii i shaderach fal, na syntetycznym
  kolorowym tle z obszarami przezroczystymi i półprzezroczystymi, 768 × 768.
  Cztery czasy animacji i trzy siły pola: **12/12 identycznych obrazów**, zero
  różnic kanałów RGBA. Dodatkowa kontrola bez rozmycia potwierdza, że efekt
  faktycznie wpływał na obraz. To nie jest porównanie wszystkich ekranów aplikacji.
- Sześć naprzemiennych serii pomiarów GPU, po 20 klatek na wersję: mediana
  0,514 ms przed i 0,394 ms po zmianie. Rozrzut był znaczny (odpowiednio
  0,227–0,731 ms oraz 0,303–0,611 ms). Wynik izolowanej sceny nie określa FPS
  pełnego modułu ani docelowego Windows/GPU.
- Trzy cykle rzeczywistej sceny Protecting Information w overlay mode,
  z aktywnymi falami: bez narastania liczników obiektów WebGL, pozostawionych
  RAF tej sceny i nieobsłużonych odrzuceń.
- Build i 31 testów przechodzą.

Dowody: [porównanie obrazu i GPU](./audits/2026-09-07/magnetics-comparison.json),
[cykl życia sceny](./audits/2026-09-07/magnetics-lifecycle.json).

Jeśli pełny moduł nadal będzie działał zbyt wolno, następnym krokiem powinien być
pomiar całej kompozycji na docelowym urządzeniu, zwłaszcza kosztu kopiowania
framebufferu i warstw wideo. W tej poprawce nie zmniejszano jakości tych warstw.
