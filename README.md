# AdBlockFilms — Расширение для удаления и пропуска рекламы в видео и фильмах

**AdBlockFilms** — лёгкое расширение стандарта **Manifest V3** (для Chrome, Edge, Яндекс Браузера, Brave, Opera), созданное специально для комфортного просмотра фильмов, сериалов и видеороликов без рекламы.

## Что умеет расширение

1. **Сетевая блокировка (Declarative Net Request)**
   - Блокирует запросы популярных видеорекламных сетей, VAST/VMAP-источников и popunder-скриптов.
   - Подменяет Google IMA SDK (`ima3.js`) совместимой заглушкой (`ima-stub.js`), чтобы плееры не зависали и не ругались на блокировщик.
2. **Очистка в контексте страницы (`page-interceptor.js`)**
   - Перехватывает `fetch`, `XMLHttpRequest` и `JSON.parse`: вырезает рекламные прероллы/мидроллы из VAST/VMAP XML и JSON-ответов (включая YouTube, PlayerJS, JWPlayer).
   - Защищает от скрытых `window.open` и синтетических `<a>` кликов (popunder/clickunder при нажатии на Play).
3. **Умный DOM-пропуск рекламы (`dom-ad-skipper.js`)**
   - Работает во всех `<iframe>` видеоплеерах на сайтах с фильмами.
   - Автоматически нажимает кнопки «Пропустить рекламу» / «Skip Ad» (игнорируя кнопки вроде «Пропустить заставку»).
   - Для несбрасываемых рекламных вставок: временно отключает звук, ускоряет ролик (до `16x`) и перематывает к самому концу, а после завершения возвращает исходную громкость и скорость фильма.
   - Удаляет рекламные баннеры и прозрачные клик-ловушки поверх плеера.

## Как установить (загрузить в браузер)

### Вариант 1: Скачать одним архивом (рекомендуется)

1. Скачайте готовый архив расширения: **[AdBlockFilms.zip](https://github.com/Stepan-Warriors/AdBlockFilms/raw/main/AdBlockFilms.zip)**.
2. Распакуйте архив в любую удобную папку (например, `C:\Extensions\AdBlockFilms`).
3. Откройте браузер на базе Chromium (**Google Chrome**, **Яндекс Браузер**, **Microsoft Edge**, **Brave**, **Opera**) и перейдите на страницу расширений:
   - Chrome / Brave / Яндекс: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera: `opera://extensions`
4. Включите переключатель **«Режим разработчика»** (справа вверху).
5. Нажмите **«Загрузить распакованное расширение»** (*Load unpacked*) и выберите распакованную папку `AdBlockFilms`.
6. Закрепите иконку **AdBlockFilms** на панели браузера для быстрого управления и просмотра статистики.

### Вариант 2: Через Git

```bash
git clone https://github.com/Stepan-Warriors/AdBlockFilms.git
```
Далее выполните шаги 3–6, выбрав склонированную папку `AdBlockFilms`.

### Установка на телефон (Android и iOS)

#### Android (Kiwi Browser, Lemur Browser, Mises Browser)

Обычный Google Chrome для Android не поддерживает сторонние расширения, но **AdBlockFilms** работает в мобильных браузерах на базе Chromium:

1. Установите **Kiwi Browser** (или **Lemur Browser** / **Mises Browser**) из Google Play.
2. Скачайте на телефон архив **[AdBlockFilms.zip](https://github.com/Stepan-Warriors/AdBlockFilms/raw/main/AdBlockFilms.zip)**.
3. Откройте меню браузера (`⋮` справа вверху) → **Extensions** (Расширения).
4. Включите **Developer mode** (Режим разработчика).
5. Нажмите **`+ (from .zip/.crx/.user.js)`** (в Kiwi) или выберите загрузку `.zip` / распакованной папки и укажите скачанный `AdBlockFilms.zip`.
6. Готово — управлять расширением можно через меню `⋮` → **AdBlockFilms**.

#### iPhone и iPad (iOS)

На iOS расширения формата Chrome Manifest V3 не поддерживаются ни в одном браузере (все браузеры на iOS работают на движке WebKit и допускают только расширения для Safari из App Store).

## Проверка проекта

```bash
python tests/validate.py
```
